import { CreateProjectResponse } from '@targus/core';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';

import type { AppEnv } from '../../src/app-env.ts';
import { createApp } from '../../src/app.ts';
import { createWorkerDeps } from '../../src/cloudflare/worker-deps.ts';
import type { AppDeps } from '../../src/composition.ts';
import type { Observability } from '../../src/middleware/request-log.ts';
import { fakeObservability } from './logs.ts';

/** The admin token the route tests run with (wrangler.jsonc sets none). */
export const adminToken = 'test-admin-token';
/** The session secret the route tests run with; `signIn` signs cookies with it. */
export const sessionSecret = 'test-session-secret';

/** The Worker's own dependencies over the local D1 and R2, with the test secrets set. */
const testDeps = createWorkerDeps({
  ...env,
  ADMIN_TOKEN: adminToken,
  SESSION_SECRET: sessionSecret,
});
// Route tests keep request lines in memory instead of printing one per request.
const defaultApp = createApp(testDeps, fakeObservability());

/**
 * The real app with some dependencies replaced, e.g. a GitHub client that knows members.
 * `observe` receives the request lines (see `test/support/logs.ts`).
 */
export function appWith(
  overrides: Partial<AppDeps>,
  observe: Observability = fakeObservability(),
): Hono<AppEnv> {
  return createApp({ ...testDeps, ...overrides }, observe);
}

/** Send a request through the full app (by default over the local D1 and R2). */
export function call(
  path: string,
  init: RequestInit = {},
  app: Hono<AppEnv> = defaultApp,
): Promise<Response> {
  return Promise.resolve(app.request(`http://targus.test${path}`, init));
}

export function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

/** `POST` JSON with a bearer token. */
export function postJson(path: string, token: string, body: unknown): Promise<Response> {
  return call(path, {
    method: 'POST',
    headers: { ...bearer(token), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

let projectCounter = 0;

/** A random suffix, so names stay unique across test files sharing the local D1. */
function randomSuffix(): string {
  return crypto.getRandomValues(new Uint32Array(1)).join('');
}

/** A GitHub org name no other test uses, for tests that need orgs of their own. */
export function uniqueOrg(prefix: string): string {
  return `${prefix}-${randomSuffix()}`;
}

/**
 * Create a project through the admin route and return it with its token. Projects land in the
 * org `example-org` unless `githubOrg` names another; a non-null `installationId` becomes that
 * org's App installation.
 */
export async function createTestProject(
  installationId: number | null = null,
  githubOrg = 'example-org',
): Promise<CreateProjectResponse> {
  projectCounter += 1;
  const response = await postJson('/api/admin/projects', adminToken, {
    githubOrg,
    installationId,
    repo: `${githubOrg}/app-${projectCounter}-${randomSuffix()}`,
    name: `app ${projectCounter}`,
  });
  if (response.status !== 201) throw new Error(`createTestProject: ${response.status}`);
  return CreateProjectResponse.parse(await response.json());
}

/** `PUT /api/images/:hash`. */
export function putImage(token: string, hash: string, bytes: Uint8Array): Promise<Response> {
  return call(`/api/images/${hash}`, {
    method: 'PUT',
    headers: { ...bearer(token), 'content-type': 'image/png' },
    body: bytes,
  });
}
