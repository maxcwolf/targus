import type { APIRequestContext } from '@playwright/test';
import { z } from 'zod';

import { e2eConfig } from '../config.js';

// Just the response fields the e2e suite asserts on. The full contracts live in @targus/core and
// are tested in apps/api; here a field that went missing or changed type fails the parse.

const CreatedProject = z.object({ token: z.string().min(32) });

const BuildBody = z.object({
  build: z.object({
    id: z.string(),
    sha: z.string(),
    branch: z.string(),
    prNumber: z.number().nullable(),
    trigger: z.enum(['pr', 'main']),
    status: z.string(),
    baselineBuildId: z.string().nullable(),
    checkRunId: z.number().nullable(),
  }),
  summary: z.object({ status: z.string(), pendingCount: z.number() }),
});
export type BuildBody = z.infer<typeof BuildBody>;

const SnapshotsBody = z.object({
  snapshots: z.array(
    z.object({ storyId: z.string(), state: z.string(), imageHash: z.string().nullable() }),
  ),
});
export type SnapshotsBody = z.infer<typeof SnapshotsBody>;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function json(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<unknown> {
  if (!response.ok()) {
    throw new Error(`${response.url()} answered ${response.status()}: ${await response.text()}`);
  }
  return response.json();
}

/**
 * Create a project through the admin route and return its token (shown once). The GitHub org is
 * the repo's owner; orgs are shared between projects, so specs that need different installation
 * settings use different owners. With an installation id the Worker reports check runs to the
 * GitHub stub and checks org membership there; without one it skips both.
 */
export async function createProject(
  request: APIRequestContext,
  repo: string,
  installationId: number | null = null,
): Promise<string> {
  const response = await request.post('/api/admin/projects', {
    headers: bearer(e2eConfig.adminToken),
    data: { githubOrg: repo.split('/')[0], installationId, repo, name: repo },
  });
  return CreatedProject.parse(await json(response)).token;
}

export async function getBuild(
  request: APIRequestContext,
  token: string,
  buildId: string,
): Promise<BuildBody> {
  return BuildBody.parse(
    await json(await request.get(`/api/builds/${buildId}`, { headers: bearer(token) })),
  );
}

export async function listSnapshots(
  request: APIRequestContext,
  token: string,
  buildId: string,
): Promise<SnapshotsBody['snapshots']> {
  const response = await request.get(`/api/builds/${buildId}/snapshots`, {
    headers: bearer(token),
  });
  return SnapshotsBody.parse(await json(response)).snapshots;
}

export async function getImage(
  request: APIRequestContext,
  token: string,
  hash: string,
): Promise<{ contentType: string | undefined; body: Buffer }> {
  const response = await request.get(`/api/images/${hash}`, { headers: bearer(token) });
  if (!response.ok()) throw new Error(`GET /api/images/${hash} answered ${response.status()}`);
  return { contentType: response.headers()['content-type'], body: await response.body() };
}
