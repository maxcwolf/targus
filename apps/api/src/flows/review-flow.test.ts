import {
  ApproveAllResponse,
  CreateBuildResponse,
  GetBuildResponse,
  ListSnapshotsResponse,
  ReviewSnapshotResponse,
  SubmitResultsResponse,
  type Snapshot,
} from '@targus/core';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { OctokitGitHubClient } from '../adapters/github-client.adapter.js';
import type { AppEnv } from '../app-env.js';
import { appWith, bearer, call, createTestProject, putImage } from '../../test/support/api.js';
import { captured, createBuildRequest, sha, storyResult } from '../../test/support/fixtures.js';
import {
  createGitHubStub,
  generatePrivateKeyPem,
  type GitHubStub,
} from '../../test/support/github-stub.js';
import { pngFixture } from '../../test/support/png.js';
import { signIn, withCookie } from '../../test/support/session.js';

// The review flow over HTTP with the real local D1 and R2 and Octokit against a stubbed GitHub:
// the CLI publishes a build with changes, a reviewer of the org approves, denies and approves
// all from the review UI, and the targus/ios check run follows every decision.

type Png = Awaited<ReturnType<typeof pngFixture>>;

interface Flow {
  readonly app: Hono<AppEnv>;
  readonly stub: GitHubStub;
  readonly token: string;
  readonly cookie: string;
  readonly buildId: string;
  readonly pngs: readonly Png[];
  readonly snapshots: ReadonlyMap<string, Snapshot>;
}

const stories = ['button', 'card', 'header'] as const;

/** The CLI side: open a build with three new stories, upload them, submit the results. */
async function publishBuild(app: Hono<AppEnv>, token: string, pngs: readonly Png[]) {
  const request = createBuildRequest(sha('a'), {
    snapshots: stories.map((story, index) => captured(story, pngs[index]?.hash ?? '')),
  });
  const created = await call(
    '/api/builds',
    {
      method: 'POST',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      body: JSON.stringify(request),
    },
    app,
  );
  const { build } = CreateBuildResponse.parse(await created.json());
  for (const png of pngs) await putImage(token, png.hash, png.bytes);
  const submitted = await call(
    `/api/builds/${build.id}/results`,
    {
      method: 'POST',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      body: JSON.stringify({
        durationMs: 1,
        results: stories.map((story, index) =>
          storyResult(story, { imageHash: pngs[index]?.hash ?? null, title: 'Kit', name: story }),
        ),
      }),
    },
    app,
  );
  const result = SubmitResultsResponse.parse(await submitted.json());
  expect(result).toMatchObject({
    summary: { status: 'pending', pendingCount: 3 },
    checkRun: { id: 901 },
  });
  return build.id;
}

async function setup(): Promise<Flow> {
  const stub = createGitHubStub(['octocat']);
  const github = new OctokitGitHubClient(
    { appId: '123', privateKey: await generatePrivateKeyPem() },
    stub.fetch,
  );
  const app = appWith({ github });
  const { token } = await createTestProject(42);
  const pngs = await Promise.all(stories.map((_, index) => pngFixture(3, 3, 100 + index)));
  const buildId = await publishBuild(app, token, pngs);
  const { cookie } = await signIn('octocat');
  const listed = await call(
    `/api/builds/${buildId}/snapshots`,
    { headers: withCookie(cookie) },
    app,
  );
  const parsed = ListSnapshotsResponse.parse(await listed.json()).snapshots;
  expect(parsed.map((snapshot) => [snapshot.title, snapshot.name])).toContainEqual(['Kit', 'card']);
  const snapshots = new Map(parsed.map((snapshot) => [snapshot.storyId, snapshot]));
  return { app, stub, token, cookie, buildId, pngs, snapshots };
}

async function review(flow: Flow, story: string, decision: 'approve' | 'deny') {
  const id = flow.snapshots.get(story)?.id ?? '';
  const response = await call(
    `/api/snapshots/${id}/review`,
    {
      method: 'POST',
      headers: { ...withCookie(flow.cookie), 'content-type': 'application/json' },
      body: JSON.stringify({ decision }),
    },
    flow.app,
  );
  expect(response.status).toBe(200);
  return ReviewSnapshotResponse.parse(await response.json());
}

/** The body of the last PATCH of check run 901. */
function lastCheckRunUpdate(flow: Flow): unknown {
  const patches = flow.stub.requests.filter(
    (request) => request.method === 'PATCH' && request.path.endsWith('/check-runs/901'),
  );
  return patches.at(-1)?.body;
}

async function approveAll(flow: Flow) {
  const response = await call(
    `/api/builds/${flow.buildId}/approve-all`,
    { method: 'POST', headers: withCookie(flow.cookie) },
    flow.app,
  );
  return ApproveAllResponse.parse(await response.json());
}

/** Approve one, deny one: the check run fails; approve-all leaves the denial standing. */
async function denialFailsTheCheck(flow: Flow): Promise<void> {
  expect((await review(flow, 'button', 'approve')).summary.status).toBe('pending');
  expect((await review(flow, 'card', 'deny')).summary).toMatchObject({
    status: 'denied',
    deniedCount: 1,
  });
  expect(lastCheckRunUpdate(flow)).toMatchObject({
    status: 'completed',
    conclusion: 'failure',
    output: { summary: '1 change denied' },
  });

  const all = await approveAll(flow);
  expect(all).toMatchObject({ approvedCount: 1, summary: { status: 'denied' } });
}

/** Approving the denied change accepts the build and passes the check run. */
async function approvalAcceptsTheBuild(flow: Flow): Promise<void> {
  const accepted = await review(flow, 'card', 'approve');
  expect(accepted.summary).toMatchObject({ status: 'accepted', conclusion: 'success' });
  expect(accepted.counts).toMatchObject({ new: 3 });
  expect(lastCheckRunUpdate(flow)).toMatchObject({
    status: 'completed',
    conclusion: 'success',
    output: { summary: 'All visual changes approved' },
  });
  const read = await call(
    `/api/builds/${flow.buildId}`,
    { headers: withCookie(flow.cookie) },
    flow.app,
  );
  expect(GetBuildResponse.parse(await read.json()).build.status).toBe('accepted');
}

/** The status of each reader's request for the build and one of its images. */
async function accessStatuses(flow: Flow): Promise<Record<string, number>> {
  const outsider = await signIn('outsider');
  const image = `/api/images/${flow.pngs[0]?.hash ?? ''}`;
  const build = `/api/builds/${flow.buildId}`;
  const status = async (path: string, headers: Record<string, string>) =>
    (await call(path, { headers }, flow.app)).status;
  return {
    outsiderBuild: await status(build, withCookie(outsider.cookie)),
    outsiderImage: await status(image, withCookie(outsider.cookie)),
    memberImage: await status(image, withCookie(flow.cookie)),
    tokenBuild: await status(build, bearer(flow.token)),
    tokenImage: await status(image, bearer(flow.token)),
  };
}

describe('review flow: review a build and follow it on the check run', () => {
  it('fails on a denial, waits for it, accepts after approval, and scopes access by org', async () => {
    const flow = await setup();

    await denialFailsTheCheck(flow);
    await approvalAcceptsTheBuild(flow);
    expect(await accessStatuses(flow)).toEqual({
      outsiderBuild: 403,
      outsiderImage: 404,
      memberImage: 200,
      tokenBuild: 200,
      tokenImage: 200,
    });
  });
});
