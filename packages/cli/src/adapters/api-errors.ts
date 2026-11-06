import { TargusError, type TargusErrorCode } from '@targus/core';
import { z } from 'zod';

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

/** The one form a request id takes at the end of an error message, so a user can quote it. */
function withRequestId(message: string, requestId: string | null): string {
  return requestId === null ? message : `${message} (request id: ${requestId})`;
}

/**
 * A failed API request. `retryable` says whether sending it again could succeed. `requestId` is
 * the id the API gave the request (ADR 0020), appended to the message as `(request id: ...)`;
 * `summary` is the message without it.
 */
export class ApiRequestError extends TargusError {
  override readonly name = 'ApiRequestError';
  readonly retryable: boolean;
  readonly requestId: string | null;
  readonly summary: string;

  constructor(
    code: TargusErrorCode,
    message: string,
    options: ErrorOptions & {
      readonly retryable?: boolean;
      readonly requestId?: string | null;
    } = {},
  ) {
    const requestId = options.requestId ?? null;
    super(code, withRequestId(message, requestId), options);
    this.retryable = options.retryable ?? false;
    this.requestId = requestId;
    this.summary = message;
  }
}

export function isRetryable(error: unknown): boolean {
  return error instanceof ApiRequestError && error.retryable;
}

/** 429 and 5xx may pass on a retry; 501 will not, and no other 4xx will either. */
function retryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status !== 501);
}

interface Described {
  readonly method: string;
  readonly route: string;
}

const ErrorBody = z.union([
  z.object({ error: z.object({ message: z.string().min(1) }) }),
  z.object({ error: z.string().min(1) }),
  z.object({ message: z.string().min(1) }),
]);

/** Every API error body carries the request id as `error.requestId` (apps/api/src/errors.ts). */
const RequestIdBody = z.object({ error: z.object({ requestId: z.string().min(1) }) });

/** The response header with the request id, for a body that has none (say, an edge 502). */
const requestIdHeader = 'x-request-id';

/** What a non-2xx response says: its message, and the request id when it has one. */
export interface ErrorDetail {
  readonly detail: string;
  readonly requestId: string | null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function messageOf(body: unknown): string | null {
  const parsed = ErrorBody.safeParse(body);
  if (!parsed.success) return null;
  const known = parsed.data;
  if ('message' in known) return known.message;
  return typeof known.error === 'string' ? known.error : known.error.message;
}

/**
 * The server's error message when the body carries one, else the status text; and the request
 * id, from the body or else the `x-request-id` header.
 */
export async function errorDetail(response: Response): Promise<ErrorDetail> {
  const text = await response.text().catch(() => '');
  const body = parseJson(text);
  const fromBody = RequestIdBody.safeParse(body);
  const fromHeader = response.headers.get(requestIdHeader);
  const requestId = fromBody.success
    ? fromBody.data.error.requestId
    : fromHeader === ''
      ? null
      : fromHeader;
  const detail =
    messageOf(body) ?? (text.trim().slice(0, 200) || response.statusText || 'no response body');
  return { detail, requestId };
}

/**
 * A non-2xx answer. A 409 on a retry most likely means the try before it was applied and only
 * its response was lost, so the message says so.
 */
export function statusError(
  { method, route }: Described,
  status: number,
  { detail, requestId }: ErrorDetail,
  attempt: number,
): ApiRequestError {
  const lostResponse =
    status === 409 && attempt > 1
      ? '; an earlier attempt may have succeeded before its response was lost'
      : '';
  return new ApiRequestError(
    errorCodeForStatus(status),
    `${method} ${route} failed with ${status}: ${detail}${lostResponse}`,
    { retryable: retryableStatus(status), requestId },
  );
}

/** No answer at all: a timeout (`timeout` is its duration) or a network failure. */
export function transportError(
  { method, route }: Described,
  baseUrl: string,
  timeout: string | null,
  cause: unknown,
): ApiRequestError {
  const message =
    timeout === null
      ? `${method} ${route}: cannot reach ${baseUrl}`
      : `${method} ${route}: no response from ${baseUrl} within ${timeout}`;
  return new ApiRequestError('internal', message, { cause, retryable: true });
}

/** The last retryable failure, saying how many tries were made; the id is the last try's. */
export function gaveUp(error: unknown, attempts: number): unknown {
  if (!(error instanceof ApiRequestError) || attempts < 2) return error;
  return new ApiRequestError(error.code, `${error.summary} (gave up after ${attempts} attempts)`, {
    cause: error,
    requestId: error.requestId,
  });
}
