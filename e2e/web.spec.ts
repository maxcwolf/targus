import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { e2eConfig } from './config.ts';
import { createProject, getBuild, listSnapshots } from './support/api.ts';
import { headSha, targusRun } from './support/cli.ts';

const apiUrl = `http://127.0.0.1:${e2eConfig.port}`;
/** A stand-in for `storybook build` output; see the comment in its iframe.html. */
const storybook = path.join(import.meta.dirname, 'fixtures', 'web-storybook');

let outDir: string;

test.beforeEach(async () => {
  outDir = await mkdtemp(path.join(tmpdir(), 'targus-e2e-web-'));
});

test.afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

/** `targus run --platform web` on the fixture Storybook, as a main build. */
async function runWeb(token: string) {
  const sha = await headSha();
  const target = ['--platform', 'web', '--storybook', storybook, '--out', outDir];
  return targusRun(token, [...target, '--branch', 'main', '--sha', sha, '--api-url', apiUrl]);
}

test('targus run --platform web captures a Storybook in Chromium and opens a web build', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const token = await createProject(request, `e2e-cli/web-${path.basename(outDir)}`);

  const run = await runWeb(token);

  expect(run.stdout).toMatch(/opening .* in chromium [\d.]+ at 1200x900, pixel ratio 1/);
  expect((await getBuild(request, token, run.buildId)).build).toMatchObject({
    platform: 'web',
    pixelRatio: 1,
    appearance: null,
  });
  // The docs entry is not a story; the hidden story is skipped through parameters.chromatic.
  const snapshots = await listSnapshots(request, token, run.buildId);
  expect(
    snapshots.map(({ storyId, variant, state, width, height }) => [
      `${storyId} ${variant}`,
      state,
      width,
      height,
    ]),
  ).toEqual([
    ['swatch--broken default', 'error', null, null],
    ['swatch--red default', 'new', 1200, 80],
    ['swatch--themed dark', 'new', 1200, 60],
    ['swatch--themed light', 'new', 1200, 60],
    ['swatch--themed narrow', 'new', 320, 60],
  ]);
  const themed = snapshots.filter((snapshot) => snapshot.storyId === 'swatch--themed');
  expect(new Set(themed.map((snapshot) => snapshot.imageHash)).size).toBe(3);

  expect((await readdir(outDir)).sort()).toEqual([
    'manifest.json',
    'swatch--red.png',
    'swatch--themed@dark.png',
    'swatch--themed@light.png',
    'swatch--themed@narrow.png',
  ]);
});
