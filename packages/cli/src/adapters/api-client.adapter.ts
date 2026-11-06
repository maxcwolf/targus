import { setTimeout as delay } from 'node:timers/promises';

import {
  CreateBuildResponse,
  isTargusError,
  SubmitResultsResponse,
  UploadImageResponse,
  type CreateBuildRequest,
  type SubmitResultsRequest,
} from '@targus/core';
import { z } from 'zod';

import { formatDuration } from '../duration.ts';
import { defaultRetryPolicy, withRetry, type RetryPolicy } from '../retry.ts';
import type { TargusApi } from '../run/targus-api.ts';
import {
  ApiRequestError,
  errorDetail,
  gaveUp,
  isRetryable,
  statusError,
  transportError,
} from './api-errors.ts';

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** How long one request may take, body included; a multi-MB upload on a slow runner fits. */
export const defaultRequestTimeoutMs = 60_000;

export interface TargusApiClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetch?: Fetch;
  /** Abort a request that has not finished, body included, within this long. */
  readonly timeoutMs?: number;
  /** Retries of idempotent requests on network errors, timeouts, 429 and 5xx. */
  readonly retry?: RetryPolicy;
  /** Waits between retries; injected so tests do not really wait. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** The signal that aborts a request after `ms`; `AbortSignal.timeout` by default. */
  readonly timeoutSignal?: (ms: number) => AbortSignal;
  /** Told about each retry, so the run can print a warning. */
  readonly onRetry?: (message: string) => void;
}

interface ApiRequest {
  readonly method: string;
  readonly route: string;
  readonly body?: RequestInit['body'];
  readonly contentType?: string;
  /** Safe to send twice: uploads are content-addressed, submissions are guarded on the server. */
  readonly idempotent: boolean;
}

/**
 * `TargusApi` over HTTP with global `fetch`. Every JSON response is checked with its core schema.
 * Every request has a timeout; idempotent ones are retried with backoff (`retry`).
 */
export class TargusApiClient implements TargusApi {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetch: Fetch;
  private readonly timeoutMs: number;
  private readonly retry: RetryPolicy;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutSignal: (ms: number) => AbortSignal;
  private readonly onRetry: (message: string) => void;

  constructor(options: TargusApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? defaultRequestTimeoutMs;
    this.retry = options.retry ?? defaultRetryPolicy;
    this.sleep = options.sleep ?? ((ms) => delay(ms));
    this.timeoutSignal = options.timeoutSignal ?? ((ms) => AbortSignal.timeout(ms));
    this.onRetry = options.onRetry ?? (() => undefined);
  }

  /** Not retried: every POST opens a new build, so a retry could leave a stray one behind. */
  async createBuild(request: CreateBuildRequest): Promise<CreateBuildResponse> {
    const send = { method: 'POST', route: '/api/builds', idempotent: false };
    return this.json(send, request, CreateBuildResponse);
  }

  async uploadImage(hash: string, png: Uint8Array): Promise<UploadImageResponse> {
    const request = {
      method: 'PUT',
      route: `/api/images/${hash}`,
      body: new Uint8Array(png),
      contentType: 'image/png',
      idempotent: true,
    };
    return this.send(request, (response) => parse(request, response, UploadImageResponse));
  }

  async getImage(hash: string): Promise<Uint8Array> {
    const request = { method: 'GET', route: `/api/images/${hash}`, idempotent: true };
    return this.send(request, async (response) => new Uint8Array(await response.arrayBuffer()));
  }

  /** Retried: the server stores results only while the build is open, so a resend is a 409. */
  async submitResults(
    buildId: string,
    request: SubmitResultsRequest,
  ): Promise<SubmitResultsResponse> {
    const route = `/api/builds/${encodeURIComponent(buildId)}/results`;
    return this.json({ method: 'POST', route, idempotent: true }, request, SubmitResultsResponse);
  }

  private async json<T>(
    request: Omit<ApiRequest, 'body' | 'contentType'>,
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const withBody = { ...request, body: JSON.stringify(body), contentType: 'application/json' };
    return this.send(withBody, (response) => parse(request, response, schema));
  }

  private async send<T>(request: ApiRequest, read: (response: Response) => Promise<T>) {
    if (!request.idempotent) return this.attempt(request, read, 1);
    return withRetry((attempt) => this.attempt(request, read, attempt), this.retry, {
      sleep: this.sleep,
      isRetryable,
      onRetry: (error, next, delayMs) => {
        const what = error instanceof Error ? error.message : String(error);
        const attempts = `attempt ${next} of ${this.retry.attempts}`;
        this.onRetry(`warning: ${what}; retrying in ${formatDuration(delayMs)} (${attempts})`);
      },
      onGiveUp: gaveUp,
    });
  }

  /** One try: the response read with `read` inside the timeout, failures as `ApiRequestError`. */
  private async attempt<T>(
    request: ApiRequest,
    read: (response: Response) => Promise<T>,
    attempt: number,
  ): Promise<T> {
    const { method, route, body, contentType } = request;
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}` };
    if (contentType !== undefined) headers['content-type'] = contentType;
    const signal = this.timeoutSignal(this.timeoutMs);
    try {
      const init = { method, headers, signal, ...(body == null ? {} : { body }) };
      const response = await this.fetch(`${this.baseUrl}${route}`, init);
      if (!response.ok) {
        throw statusError(request, response.status, await errorDetail(response), attempt);
      }
      return await read(response);
    } catch (error) {
      if (isTargusError(error)) throw error;
      const timeout = signal.aborted ? formatDuration(this.timeoutMs) : null;
      throw transportError(request, this.baseUrl, timeout, error);
    }
  }
}

async function parse<T>(
  { method, route }: Pick<ApiRequest, 'method' | 'route'>,
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (error) {
    throw new ApiRequestError('internal', `${method} ${route} returned invalid JSON`, {
      cause: error,
    });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const detail = z.prettifyError(parsed.error);
    throw new ApiRequestError(
      'internal',
      `${method} ${route} returned an unexpected body:\n${detail}`,
    );
  }
  return parsed.data;
}
