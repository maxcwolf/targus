import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { e2eConfig } from './config.ts';
import { getBuild } from './support/api.ts';
import { publishMainBuild, publishPrBuild } from './support/builds.ts';
import { mergeBaseSha, repoCheckout } from './support/cli.ts';
import { checkRunsFor, signInNextAs } from './support/github.ts';

// The review flow of docs/engineering-standards.md section 3.3: builds published by the CLI,
// sign-in through the stubbed GitHub OAuth, approve-all on the first build so it becomes the
// baseline, then one changed story denied and approved on a PR build, with the check-run calls
// the stub received asserted after each decision.

const apiUrl = `http://127.0.0.1:${e2eConfig.port}`;

// The stub's "who signs in next" is one global, so the tests of this file run one after another
// (other files still run in parallel; they never sign in).
test.describe.configure({ mode: 'default' });

/** Open a build page signed out, sign in through the stub, and land back on the build. */
async function signInOn(page: Page, buildPath: string): Promise<void> {
  await page.goto(buildPath);
  await page.getByRole('link', { name: 'Sign in with GitHub' }).click();
  await expect(page).toHaveURL(new RegExp(`${buildPath.replaceAll('/', '\\/')}$`));
}

/** The accepted main build is what the library shows: its three stories, images included. */
async function expectLibraryOfThreeStories(page: Page): Promise<void> {
  const rail = page.getByRole('navigation', { name: 'App' });
  await rail.getByRole('link', { name: 'Library' }).click();
  await expect(page.locator('.story-card')).toHaveCount(3);
  await page.getByRole('link', { name: 'Fixture/Solid : Red' }).click();
  const capture = page.getByRole('img', { name: 'Fixture/Solid : Red' });
  await expect
    .poll(() => capture.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
}

let dir: string;

/** A main build (all new) on the merge base of a new project; see support/builds.ts. */
async function publishBuilds(request: APIRequestContext, buildsDir: string) {
  return publishMainBuild(request, {
    apiUrl,
    repo: `e2e/review-${path.basename(buildsDir)}`,
    dir: buildsDir,
    checkout: await repoCheckout(),
  });
}

test.beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'targus-e2e-review-'));
});

test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('a reviewer approves a baseline, then denies and approves a changed story', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await signInNextAs(request, 'octocat');
  const published = await publishBuilds(request, dir);
  const { repo, token, mainBuildId } = published;

  // The CLI created the check run as in progress: three new stories await review.
  expect(await checkRunsFor(request, repo)).toMatchObject([
    { method: 'POST', body: { status: 'in_progress', head_sha: await mergeBaseSha() } },
  ]);

  await signInOn(page, `/builds/${mainBuildId}`);
  await expect(page.getByRole('banner')).toContainText('octocat');
  await expect(page.getByRole('status', { name: 'Build status' })).toHaveText('Pending review');

  await page.getByRole('button', { name: 'Batch' }).click();
  await page.getByRole('button', { name: /^Confirm/ }).click();
  await expect(page.getByRole('status', { name: 'Build status' })).toHaveText('Accepted');
  expect((await checkRunsFor(request, repo)).at(-1)).toMatchObject({
    method: 'PATCH',
    body: { status: 'completed', conclusion: 'success' },
  });

  await expectLibraryOfThreeStories(page);

  // The accepted main build is the baseline of the PR build: one changed, two unchanged.
  const prBuildId = await publishPrBuild(published);
  const pr = await getBuild(request, token, prBuildId);
  expect(pr.build.baselineBuildId).toBe(mainBuildId);
  expect(pr.summary).toMatchObject({ status: 'pending', pendingCount: 1 });

  await page.goto(`/builds/${prBuildId}`);
  await expect(page.getByRole('status', { name: 'Build status' })).toHaveText('Pending review');
  // The primary action opens the first (here the only) unreviewed change.
  await page.getByRole('link', { name: 'Verify changes' }).click();
  await expect(page).toHaveURL(/\/snapshots\/[^?]+\?filter=unreviewed$/);
  await expect(page.getByRole('heading', { name: /Red/ })).toBeVisible();
  // Deny and Approve open only once every capture on screen has loaded in the browser.
  await expect(page.getByRole('img', { name: 'Baseline' })).toHaveClass(/is-loaded/);
  await expect(page.getByRole('img', { name: 'New' })).toHaveClass(/is-loaded/);
  await expect(page.getByRole('button', { name: 'Approve' })).toBeEnabled();

  await page.getByRole('button', { name: 'Deny' }).click();
  await expect(page.getByRole('status', { name: 'Review' })).toHaveText('Denied');
  expect((await checkRunsFor(request, repo)).at(-1)).toMatchObject({
    method: 'PATCH',
    body: { status: 'completed', conclusion: 'failure' },
  });

  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('status', { name: 'Review' })).toHaveText('Approved');
  expect((await checkRunsFor(request, repo)).at(-1)).toMatchObject({
    method: 'PATCH',
    body: { status: 'completed', conclusion: 'success' },
  });
  expect((await getBuild(request, token, prBuildId)).summary.status).toBe('accepted');
});

test('a GitHub user outside the org cannot review', async ({ page, request }) => {
  test.setTimeout(120_000);
  const { mainBuildId } = await publishBuilds(request, dir);

  await signInNextAs(request, 'outsider');
  await signInOn(page, `/builds/${mainBuildId}`);
  await signInNextAs(request, 'octocat');

  await expect(page.getByText(/not a member/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Batch' })).toHaveCount(0);
});
