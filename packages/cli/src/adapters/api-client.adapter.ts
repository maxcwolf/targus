import {
  CreateBuildResponse,
  SubmitResultsResponse,
  TargusError,
  UploadImageResponse,
  type CreateBuildRequest,
  type SubmitResultsRequest,
  type TargusErrorCode,
} from '@targus/core';
import { z } from 'zod';

import type { TargusApi } from '../run/targus-api.js';

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface TargusApiClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetch?: Fetch;
}

const statusCodes: Readonly<Record<number, TargusErrorCode>> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'bad_request',
  501: 'not_implemented',
};

/** The TargusError code for a non-2xx HTTP status; anything unlisted is `internal`. */
export function errorCodeForStatus(status: number): TargusErrorCode {
  return statusCodes[status] ?? 'internal';
}

const ErrorBody = z.union([
  z.object({ error: z.object({ message: z.string().min(1) }) }),
  z.object({ error: z.string().min(1) }),
  z.object({ message: z.string().min(1) }),
]);

/** The server's error message when the body carries one, else the status text. */
async function errorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const body = ErrorBody.parse(JSON.parse(text));
    if ('message' in body) return body.message;
    return typeof body.error === 'string' ? body.error : body.error.message;
  } catch {
    return text.trim().slice(0, 200) || response.statusText || 'no response body';
  }
}

/** `TargusApi` over HTTP with global `fetch`. Every JSON response is checked with its core schema. */
export class TargusApiClient implements TargusApi {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetch: Fetch;

  constructor({ baseUrl, token, fetch = globalThis.fetch }: TargusApiClientOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.fetch = fetch;
  }

  async createBuild(request: CreateBuildRequest): Promise<CreateBuildResponse> {
    return this.json('POST', '/api/builds', request, CreateBuildResponse);
  }

  async uploadImage(hash: string, png: Uint8Array): Promise<UploadImageResponse> {
    const response = await this.send('PUT', `/api/images/${hash}`, {
      body: new Uint8Array(png),
      contentType: 'image/png',
    });
    return this.parse('PUT', `/api/images/${hash}`, response, UploadImageResponse);
  }

  async getImage(hash: string): Promise<Uint8Array> {
    const response = await this.send('GET', `/api/images/${hash}`, {});
    return new Uint8Array(await response.arrayBuffer());
  }

  async submitResults(
    buildId: string,
    request: SubmitResultsRequest,
  ): Promise<SubmitResultsResponse> {
    const route = `/api/builds/${encodeURIComponent(buildId)}/results`;
    return this.json('POST', route, request, SubmitResultsResponse);
  }

  private async json<T>(
    method: string,
    route: string,
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const response = await this.send(method, route, {
      body: JSON.stringify(body),
      contentType: 'application/json',
    });
    return this.parse(method, route, response, schema);
  }

  private async send(
    method: string,
    route: string,
    { body, contentType }: { body?: RequestInit['body']; contentType?: string },
  ): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}` };
    if (contentType !== undefined) headers['content-type'] = contentType;
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}${route}`, {
        method,
        headers,
        ...(body === undefined || body === null ? {} : { body }),
      });
    } catch (error) {
      throw new TargusError('internal', `${method} ${route}: cannot reach ${this.baseUrl}`, {
        cause: error,
      });
    }
    if (!response.ok) {
      const detail = await errorDetail(response);
      const message = `${method} ${route} failed with ${response.status}: ${detail}`;
      throw new TargusError(errorCodeForStatus(response.status), message);
    }
    return response;
  }

  private async parse<T>(
    method: string,
    route: string,
    response: Response,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new TargusError('internal', `${method} ${route} returned invalid JSON`, {
        cause: error,
      });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const detail = z.prettifyError(parsed.error);
      throw new TargusError(
        'internal',
        `${method} ${route} returned an unexpected body:\n${detail}`,
      );
    }
    return parsed.data;
  }
}
