import { CreateBuildResponse, ListSnapshotsResponse, type StoryResult } from '@targus/core';
import { env } from 'cloudflare:workers';
import { expect } from 'vitest';

import { createImageRepository } from '../../src/repositories/image.repository.ts';

import { createRecordingGitHub } from './github-recorder.ts';
import { appWith, bearer, call, createTestProject, postJson } from './api.ts';
import { createBuildRequest, sha } from './fixtures.ts';
import { markUploaded } from './in-memory-images.ts';
import { withCookie } from './session.ts';

/** The app with a GitHub client for which only `octocat` is an org member. */
export const reviewApp = appWith({ github: createRecordingGitHub(['octocat']) });

/**
 * A project with an installation (so membership can be checked) and one completed build. The
 * results' made-up hashes are marked as uploaded by the project, since nothing uploads them.
 * The project is in `example-org` with installation 42 unless `org` says otherwise.
 */
export async function projectWithBuild(
  results: StoryResult[],
  org: { readonly githubOrg?: string; readonly installationId?: number } = {},
) {
  const { token, project } = await createTestProject(org.installationId ?? 42, org.githubOrg);
  const created = await postJson('/api/builds', token, createBuildRequest(sha('a')));
  const { build } = CreateBuildResponse.parse(await created.json());
  await markUploaded(createImageRepository(env.DB), project.id, results);
  const submitted = await postJson(`/api/builds/${build.id}/results`, token, {
    durationMs: 1,
    threshold: 0.001,
    results,
  });
  expect(submitted.status).toBe(200);
  const listed = await call(`/api/builds/${build.id}/snapshots`, { headers: bearer(token) });
  const { snapshots } = ListSnapshotsResponse.parse(await listed.json());
  return { token, project, buildId: build.id, snapshots };
}

/** `POST` JSON with a session cookie through `reviewApp`. */
export function postAsReviewer(path: string, cookie: string, body?: unknown): Promise<Response> {
  return call(
    path,
    {
      method: 'POST',
      headers: { ...withCookie(cookie), 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    reviewApp,
  );
}

/** `GET` with a session cookie through `reviewApp`. */
export function getAsReviewer(path: string, cookie: string): Promise<Response> {
  return call(path, { headers: { cookie } }, reviewApp);
}
