import type { Clock, IdGenerator } from '@targus/core';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { matchedRoutes } from 'hono/route';

import type { AppEnv } from '../app-env.ts';
import { RequestLog, type Logger } from '../logging/request-log.ts';

/** The response header that carries the request id (and the field in error bodies). */
export const requestIdHeader = 'x-request-id';

/** What the logging middleware needs: ids and time from the ports, and where lines go. */
export interface Observability {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly logger: Logger;
}

/**
 * The route pattern that answered, like `/api/builds/:id`. Middleware registered with `use`
 * matches every method (`ALL`), so the last route with a real method is the handler; when there
 * is none, nothing matched and the not-found handler answered.
 */
function routeOf(c: Context): string | null {
  const handlers = matchedRoutes(c).filter((route) => route.method !== 'ALL');
  return handlers.at(-1)?.path ?? null;
}

/**
 * Runs first on every request (ADR 0020): gives it an id from the `IdGenerator` (never one the
 * client sent), returns it as `x-request-id`, and writes exactly one line once the response is
 * ready. Errors reach this point already turned into a response by `app.onError`, which leaves
 * the error on `c.error`.
 */
export function requestLogger(observe: Observability) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const log = new RequestLog(observe.ids.next(), observe.clock.now());
    c.set('log', log);
    await next();
    c.header(requestIdHeader, log.requestId);
    observe.logger.write(
      log.entry({
        method: c.req.method,
        route: routeOf(c),
        status: c.res.status,
        cfRay: c.req.header('cf-ray') ?? null,
        finishedAt: observe.clock.now(),
        error: c.error,
      }),
    );
  });
}
