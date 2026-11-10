import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test, type APIRequestContext } from '@playwright/test';

import { e2eConfig } from './config.ts';
import { approveAll, getBuild, listSnapshots, signInThroughStub } from './support/api.ts';
import {
  publishMainBuild,
  publishMergedBuild,
  publishPrBuild,
  type Published,
} from './support/builds.ts';
import { checkRunsFor } from './support/github.ts';
import { commitHere, createSeedCheckout, landOnMain, startBranch } from './support/seed-repo.ts';

// What a merge does to a review (ADR 0004, rules 3 to 5; docs/guide/review.md). GitHub's squash
// and rebase merges put new commits on main, so git no longer links main to the pull request's
// commits. targus does not need the link: an approval is "this story went from image A to image
// B", and the build of main after the merge is compared with main's previous build and accepts
// the same pair. Each test publishes with the real CLI from a throwaway repository with that
// history, and reviews through the API as a signed-in org member.
//
// The reviewer is whoever the GitHub stub signs in next, octocat by default. review.spec.ts
// switches it to an outsider for a moment, so this file signs in before publishing anything and
// checks who it is.

const apiUrl = `http://127.0.0.1:${e2eConfig.port}`;

let dir: string;

test.beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'targus-e2e-merge-'));
});

test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Sign in as the org member, trying again if another spec had the stub sign in an outsider. */
async function signInAsMember(request: APIRequestContext): Promise<void> {
  await expect(async () => {
    await signInThroughStub(request);
    const me = await request.get('/api/me');
    expect(await me.json()).toMatchObject({ user: { login: 'octocat' } });
  }).toPass({ timeout: 30_000 });
}

/**
 * An accepted build of main (three stories), and a pull request from it with `commits` commits
 * whose last one has a build in which one story changed, still awaiting review.
 */
async function openPullRequest(request: APIRequestContext, commits = 1) {
  await signInAsMember(request);
  const seeded = await createSeedCheckout(path.join(dir, 'repo'));
  let headSha = seeded.headSha;
  for (let extra = 1; extra < commits; extra += 1) {
    headSha = await commitHere(seeded.dir, `follow-up ${String(extra)}`);
  }
  const published = await publishMainBuild(request, {
    apiUrl,
    repo: `e2e/merge-${path.basename(dir)}`,
    dir,
    checkout: { ...seeded, headSha },
  });
  await approveAll(request, apiUrl, published.mainBuildId);
  const prBuildId = await publishPrBuild(published);
  expect((await getBuild(request, published.token, prBuildId)).summary).toMatchObject({
    status: 'pending',
    pendingCount: 1,
  });
  return { published, prBuildId };
}

/** The build of main at `sha` after a merge, and the last commit status GitHub was sent. */
async function buildOfMain(request: APIRequestContext, published: Published, sha: string) {
  const buildId = await publishMergedBuild(published, sha);
  const { build, summary } = await getBuild(request, published.token, buildId);
  const states = (await listSnapshots(request, published.token, buildId)).map((s) => s.state);
  const status = (await checkRunsFor(request, published.repo)).at(-1);
  return { buildId, build, summary, states: states.sort(), status };
}

test('a change approved on a pull request is accepted on main after a squash merge', async ({
  request,
}) => {
  test.setTimeout(180_000);
  const { published, prBuildId } = await openPullRequest(request);
  await approveAll(request, apiUrl, prBuildId);

  const squashSha = await landOnMain(published.checkout.dir, ['change one story (#7)']);
  const merged = await buildOfMain(request, published, squashSha);

  // Compared with main's previous build, not with the pull request: the story is `changed`
  // again, and the approval of that same pair of images accepts it without a second review.
  expect(merged.build).toMatchObject({
    sha: squashSha,
    trigger: 'main',
    prNumber: null,
    baselineBuildId: published.mainBuildId,
  });
  expect(merged.states).toEqual(['changed', 'unchanged', 'unchanged']);
  expect(merged.summary).toMatchObject({ status: 'accepted', pendingCount: 0 });
  expect(merged.status).toMatchObject({ sha: squashSha, body: { state: 'success' } });

  // The merged build is the next pull request's baseline, with the approved image in it.
  const nextSha = await startBranch(published.checkout.dir, 'feature/next');
  const next = { ...published, checkout: { ...published.checkout, headSha: nextSha } };
  const nextBuild = await getBuild(request, published.token, await publishPrBuild(next));
  expect(nextBuild.build.baselineBuildId).toBe(merged.buildId);
  expect(nextBuild.summary).toMatchObject({ status: 'passed', pendingCount: 0 });
});

test('a rebase merge of several commits is accepted the same way', async ({ request }) => {
  test.setTimeout(180_000);
  const { published, prBuildId } = await openPullRequest(request, 2);
  await approveAll(request, apiUrl, prBuildId);

  // Two new commits on main; only the last has a build, as CI builds the pushed tip. Its
  // baseline is found two first-parent commits back.
  const tipSha = await landOnMain(published.checkout.dir, ['change one story', 'follow-up 1']);
  expect(tipSha).not.toBe(published.checkout.headSha);
  const merged = await buildOfMain(request, published, tipSha);

  expect(merged.build.baselineBuildId).toBe(published.mainBuildId);
  expect(merged.summary).toMatchObject({ status: 'accepted', pendingCount: 0 });
  expect(merged.status).toMatchObject({ sha: tipSha, body: { state: 'success' } });
});

test('a change merged without an approval still awaits review on main', async ({ request }) => {
  test.setTimeout(180_000);
  const { published } = await openPullRequest(request);

  const squashSha = await landOnMain(published.checkout.dir, ['change one story (#7)']);
  const merged = await buildOfMain(request, published, squashSha);

  expect(merged.summary).toMatchObject({ status: 'pending', pendingCount: 1 });
  expect(merged.status).toMatchObject({ sha: squashSha, body: { state: 'pending' } });
});
