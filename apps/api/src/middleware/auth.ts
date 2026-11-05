import { createMiddleware } from 'hono/factory';

import type { AppEnv, ProjectEnv } from '../app-env.js';

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
