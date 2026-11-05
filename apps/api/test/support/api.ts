import { CreateProjectResponse } from '@targus/core';
import { env } from 'cloudflare:workers';

import { createApp } from '../../src/app.js';

/** The admin token the route tests run with (wrangler.jsonc sets none). */
export const adminToken = 'test-admin-token';

const app = createApp();
const testEnv = { ...env, ADMIN_TOKEN: adminToken };

/** Send a request through the full app with the local D1 and R2 bindings. */
export function call(path: string, init: RequestInit = {}): Promise<Response> {
  return Promise.resolve(app.request(`http://targus.test${path}`, init, testEnv));
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

/** Create a project through the admin route and return it with its token. */
export async function createTestProject(
  installationId: number | null = null,
): Promise<CreateProjectResponse> {
  projectCounter += 1;
  const response = await postJson('/api/admin/projects', adminToken, {
    githubOrg: 'example-org',
    installationId,
    repo: `example-org/app-${projectCounter}-${crypto.getRandomValues(new Uint32Array(1)).join('')}`,
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
