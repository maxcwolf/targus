import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import type { AppEnv, PrincipalEnv, ProjectEnv, ReviewerEnv } from '../app-env.js';
import type { Reviewer, Services } from '../services/index.js';
import { readSessionId, requireCookieSettings } from './session-cookie.js';

/** The token of an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return match?.[1] ?? null;
}

/** CLI routes: authenticate the project token and put the project on the context. */
export const projectAuth = createMiddleware<ProjectEnv>(async (c, next) => {
  const token = bearerToken(c.req.header('authorization'));
  c.set('project', await c.var.services.authenticateProjectToken(token));
  await next();
});

/** Admin routes: require the `ADMIN_TOKEN` bearer token. */
export const adminAuth = createMiddleware<AppEnv>(async (c, next) => {
  await c.var.services.authenticateAdmin(bearerToken(c.req.header('authorization')));
  await next();
});

async function reviewerOf(c: Context, services: Services): Promise<Reviewer> {
  const settings = requireCookieSettings(services, 'unauthorized');
  return services.authenticateSession(await readSessionId(c, settings));
}

/** Review routes: a valid `targus_session` cookie, else 401. Puts the reviewer on the context. */
export const sessionAuth = createMiddleware<ReviewerEnv>(async (c, next) => {
  c.set('reviewer', await reviewerOf(c, c.var.services));
  await next();
});

/**
 * Routes both the CLI and the review UI read: a request with an `Authorization` header is
 * authenticated as a project token, any other by its session cookie.
 */
export const readerAuth = createMiddleware<PrincipalEnv>(async (c, next) => {
  const header = c.req.header('authorization');
  if (header === undefined) {
    c.set('principal', { kind: 'reviewer', reviewer: await reviewerOf(c, c.var.services) });
  } else {
    const project = await c.var.services.authenticateProjectToken(bearerToken(header));
    c.set('principal', { kind: 'project', project });
  }
  await next();
});
