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

  // Submitting the results reported the check as pending: three new stories await review.
  expect(await checkRunsFor(request, repo)).toMatchObject([
    { sha: await mergeBaseSha(), body: { context: 'targus/ios', state: 'pending' } },
  ]);

  await signInOn(page, `/builds/${mainBuildId}`);
  await expect(page.getByRole('banner')).toContainText('octocat');
  await expect(page.getByRole('status', { name: 'Build status' })).toHaveText('Pending review');

  await page.getByRole('button', { name: 'Batch' }).click();
  await page.getByRole('button', { name: /^Confirm/ }).click();
  await expect(page.getByRole('status', { name: 'Build status' })).toHaveText('Accepted');
  expect((await checkRunsFor(request, repo)).at(-1)).toMatchObject({
    body: { state: 'success' },
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
    body: { state: 'failure' },
  });

  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('status', { name: 'Review' })).toHaveText('Approved');
  expect((await checkRunsFor(request, repo)).at(-1)).toMatchObject({
    body: { state: 'success' },
  });
  expect((await getBuild(request, token, prBuildId)).summary.status).toBe('accepted');
});

/** Sign in on a fresh main build and open its first story, in the All filter, ready to decide. */
async function openFirstStory(page: Page, request: APIRequestContext): Promise<void> {
  await signInNextAs(request, 'octocat');
  const { mainBuildId } = await publishBuilds(request, dir);
  await signInOn(page, `/builds/${mainBuildId}`);
  await page.goto(`/builds/${mainBuildId}?filter=all`);
  await page.locator('.story-link').first().click();
  await expect(page).toHaveURL(/\/snapshots\/[^?]+\?filter=all$/);
  await expect(page.getByRole('button', { name: 'Approve' })).toBeEnabled();
}

const isReviewPost = (method: string, url: string): boolean =>
  method === 'POST' && /\/api\/snapshots\/[^/]+\/review$/.test(url);

test('holding a sends one approve', async ({ page, request }) => {
  test.setTimeout(120_000);
  await openFirstStory(page, request);
  let reviews = 0;
  page.on('request', (sent) => {
    if (isReviewPost(sent.method(), sent.url())) reviews += 1;
  });

  // Each further down of a held key is a repeat, as the browser sends while it is held.
  for (let press = 0; press < 5; press += 1) await page.keyboard.down('a');
  await page.keyboard.up('a');

  await expect(page.getByRole('status', { name: 'Review' })).toHaveText('Approved');
  expect(reviews).toBe(1);
});

test('a decision that fails after moving on is still listed', async ({ page, request }) => {
  test.setTimeout(120_000);
  await openFirstStory(page, request);
  const heading = page.getByRole('heading', { level: 1 });
  const story = await heading.textContent();
  let release = (): void => undefined;
  const moved = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => isReviewPost('POST', url.href),
    async (route) => {
      await moved;
      await route.fulfill({
        status: 500,
        json: { error: { code: 'internal', message: 'Database is busy' } },
      });
    },
  );

  await page.keyboard.press('a');
  await page.keyboard.press('j');
  await expect(heading).not.toHaveText(story ?? '');
  release();

  const failures = page.getByRole('alert', { name: 'Failed decisions' });
  await expect(failures).toContainText('Approve failed. Database is busy');
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
