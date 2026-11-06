import { isTargusError, type TargusErrorCode } from '@targus/core';
import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { AppEnv } from './app-env.ts';

/** The one place a `TargusError` code becomes an HTTP status. */
const statusByCode = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  internal: 500,
  not_implemented: 501,
} as const satisfies Record<TargusErrorCode, ContentfulStatusCode>;

export function httpStatusFor(code: TargusErrorCode): ContentfulStatusCode {
  return statusByCode[code];
}

/**
 * JSON error body every API error uses. `requestId` is the request's `x-request-id`, so a user
 * reporting an error can quote the id of its log line (ADR 0020).
 */
export interface ErrorBody {
  readonly error: {
    readonly code: TargusErrorCode;
    readonly message: string;
    readonly requestId: string;
  };
}

/** An error response in the shared shape, for handlers that answer an error themselves. */
export function errorResponse(
  c: Context<AppEnv>,
  code: TargusErrorCode,
  message: string,
  status: ContentfulStatusCode = httpStatusFor(code),
): Response {
  return c.json<ErrorBody>({ error: { code, message, requestId: c.var.log.requestId } }, status);
}

/**
 * `app.onError`: typed errors map through `statusByCode`; anything else is a 500 whose detail
 * stays out of the response. Hono leaves the error on `c.error`, and `requestLogger` logs it.
 */
export const errorHandler: ErrorHandler<AppEnv> = (error, c) => {
  if (isTargusError(error)) return errorResponse(c, error.code, error.message);
  if (error instanceof HTTPException) return error.getResponse();
  return errorResponse(c, 'internal', 'Internal Server Error');
};

/** `app.notFound`: unknown /api routes answer in the same JSON shape. */
export const notFoundHandler: NotFoundHandler<AppEnv> = (c) =>
  errorResponse(c, 'not_found', `No route for ${c.req.method} ${c.req.path}`);
