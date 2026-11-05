import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test, type APIRequestContext } from '@playwright/test';
import { writeFixtureCapture } from '@targus/cli';

import { e2eConfig } from './config.js';
import { createProject, getBuild, getImage, listSnapshots } from './support/api.js';
import { headSha, targusRun } from './support/cli.js';

const apiUrl = `http://127.0.0.1:${e2eConfig.port}`;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let captureDir: string;

test.beforeEach(async () => {
  captureDir = await mkdtemp(path.join(tmpdir(), 'targus-e2e-capture-'));
});

test.afterEach(async () => {
  await rm(captureDir, { recursive: true, force: true });
});

/** A pending build with no baseline whose three fixture stories are all `new`. */
async function expectPendingNewBuild(
  request: APIRequestContext,
  token: string,
  buildId: string,
): Promise<string[]> {
  const { build, summary } = await getBuild(request, token, buildId);
  expect(build).toMatchObject({ status: 'pending', baselineBuildId: null, checkRunId: null });
  expect(summary).toMatchObject({ status: 'pending', pendingCount: 3 });

  const snapshots = await listSnapshots(request, token, buildId);
  expect(snapshots.map((snapshot) => snapshot.state)).toEqual(['new', 'new', 'new']);
  return snapshots.flatMap((snapshot) => (snapshot.imageHash === null ? [] : [snapshot.imageHash]));
}

test('targus run --from-capture publishes builds to the local Worker', async ({ request }) => {
  test.setTimeout(120_000);
  // The temp dir's random suffix keeps the repo unique when a local server is reused.
  const token = await createProject(request, `e2e/run-${path.basename(captureDir)}`);
  await writeFixtureCapture(captureDir);
  const sha = await headSha();
  const common = ['--from-capture', captureDir, '--device-name', 'e2e', '--api-url', apiUrl];

  const main = await targusRun(token, [...common, '--branch', 'main', '--sha', sha]);
  expect(main.stdout).toContain('check run: none');
  const hashes = await expectPendingNewBuild(request, token, main.buildId);
  expect((await getBuild(request, token, main.buildId)).build).toMatchObject({
    sha,
    trigger: 'main',
  });

  // The first build is pending, so it cannot be the baseline of the second.
  const args = [...common, '--branch', 'feature/e2e', '--pr', '1', '--sha', sha];
  const pr = await targusRun(token, args);
  expect(pr.buildId).not.toBe(main.buildId);
  await expectPendingNewBuild(request, token, pr.buildId);
  expect((await getBuild(request, token, pr.buildId)).build).toMatchObject({
    sha,
    branch: 'feature/e2e',
    prNumber: 1,
    trigger: 'pr',
  });

  const [hash] = hashes;
  if (hash === undefined) throw new Error('the build has no image hashes');
  const image = await getImage(request, token, hash);
  expect(image.contentType).toBe('image/png');
  expect(image.body.subarray(0, pngSignature.length).equals(pngSignature)).toBe(true);
});
