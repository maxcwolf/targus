import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CaptureReport, CaptureResult } from './capture-stories.ts';
import {
  buildManifest,
  perStoryStats,
  readCaptureManifest,
  writeCaptureOutput,
  type CaptureRunInfo,
} from './manifest.ts';

const run: CaptureRunInfo = {
  platform: 'ios',
  udid: 'SIM',
  appearance: 'dark',
  bundleId: 'co.example',
  appPath: '/apps/Example.app',
  settleMs: 300,
  stabilityGapMs: 150,
};

function result(id: string, overrides: Partial<CaptureResult> = {}): CaptureResult {
  return {
    id,
    variant: 'default',
    title: 'T',
    name: id,
    png: Uint8Array.of(1, 2, 3),
    hash: `hash-${id}`,
    width: 4,
    height: 8,
    renderMs: 2,
    captureMs: 1000,
    attempts: 1,
    stable: true,
    blank: false,
    error: null,
    ...overrides,
  };
}

const report: CaptureReport = {
  skipped: ['e'],
  startedAt: '2026-11-04T10:00:00.000Z',
  durationMs: 4200,
  stories: [
    result('a', { captureMs: 900 }),
    result('b', { stable: false, attempts: 3, captureMs: 4000 }),
    result('c', { png: null, hash: null, error: 'boom', width: 0, height: 0 }),
    result('d', { hash: 'hash-a', blank: true, captureMs: 1100 }),
  ],
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'targus-manifest-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('buildManifest', () => {
  it('summarises captures, failures, unstable, blank and duplicate stories', () => {
    const manifest = buildManifest(report, run);

    expect(manifest.summary).toEqual({
      platform: 'ios',
      device: { udid: 'SIM', appearance: 'dark', name: null },
      app: { bundleId: 'co.example', path: '/apps/Example.app' },
      storybook: null,
      viewport: null,
      pixelRatio: null,
      settleMs: 300,
      stabilityGapMs: 150,
      storyCount: 4,
      captured: 3,
      failed: 1,
      unstable: ['b'],
      blank: ['d'],
      skipped: ['e'],
      duplicateHashes: [['a', 'd']],
      startedAt: '2026-11-04T10:00:00.000Z',
      durationMs: 4200,
      perStoryMs: { mean: 2000, median: 1100, p90: 4000, max: 4000 },
    });
    expect(manifest.stories.map((story) => story.file)).toEqual(['a.png', 'b.png', null, 'd.png']);
    expect(manifest.stories[0]).not.toHaveProperty('png');
  });
});

describe('buildManifest for web', () => {
  it('records the browser, Storybook, viewport and pixel ratio instead of a device and app', () => {
    const manifest = buildManifest(report, {
      platform: 'web',
      browser: 'chromium 141.0.1',
      storybook: 'storybook-static',
      viewport: { width: 1200, height: 900 },
      pixelRatio: 2,
      settleMs: 300,
      stabilityGapMs: 150,
    });
    expect(manifest.summary).toMatchObject({
      platform: 'web',
      device: { udid: null, appearance: null, name: 'chromium 141.0.1' },
      app: null,
      storybook: 'storybook-static',
      viewport: { width: 1200, height: 900 },
      pixelRatio: 2,
    });
  });
});

describe('perStoryStats', () => {
  it('is null with no captures and exact for one', () => {
    expect(perStoryStats([])).toBeNull();
    expect(perStoryStats([7])).toEqual({ mean: 7, median: 7, p90: 7, max: 7 });
  });
});

describe('writeCaptureOutput', () => {
  it('writes a PNG per captured story and a manifest that reads back', async () => {
    const written = await writeCaptureOutput(path.join(dir, 'out'), report, run);

    const files = (await readdir(path.join(dir, 'out'))).sort();
    expect(files).toEqual(['a.png', 'b.png', 'd.png', 'manifest.json']);
    expect([...(await readFile(path.join(dir, 'out', 'a.png')))]).toEqual([1, 2, 3]);
    expect(await readCaptureManifest(path.join(dir, 'out'))).toEqual(written);
  });

  it('reads a manifest written before skipped existed as skipping nothing', async () => {
    const written = await writeCaptureOutput(path.join(dir, 'out'), report, run);
    const { skipped, ...older } = written.summary;
    await writeFile(
      path.join(dir, 'out', 'manifest.json'),
      JSON.stringify({ ...written, summary: older }),
    );

    expect(skipped).toEqual(['e']);
    expect((await readCaptureManifest(path.join(dir, 'out'))).summary.skipped).toEqual([]);
  });

  it('reads a manifest written before appearance existed as an unknown appearance', async () => {
    const written = await writeCaptureOutput(path.join(dir, 'out'), report, run);
    const older = { ...written, summary: { ...written.summary, device: { udid: 'SIM' } } };
    await writeFile(path.join(dir, 'out', 'manifest.json'), JSON.stringify(older));

    const read = await readCaptureManifest(path.join(dir, 'out'));
    expect(read.summary.device).toEqual({ udid: 'SIM', appearance: null, name: null });
  });

  it('reads a manifest written before web capture as an iOS capture', async () => {
    const written = await writeCaptureOutput(path.join(dir, 'out'), report, run);
    const { platform, storybook, viewport, pixelRatio, ...older } = written.summary;
    await writeFile(
      path.join(dir, 'out', 'manifest.json'),
      JSON.stringify({ ...written, summary: older }),
    );

    expect([platform, storybook, viewport, pixelRatio]).toEqual(['ios', null, null, null]);
    const read = await readCaptureManifest(path.join(dir, 'out'));
    expect(read.summary).toMatchObject({ platform: 'ios', storybook: null, pixelRatio: null });
  });

  it('rejects a manifest that does not match the schema', async () => {
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ version: 2 }));

    await expect(readCaptureManifest(dir)).rejects.toThrow(
      /^invalid manifest\.json in .*:\n {2}- version: /,
    );
  });

  it('rejects a manifest that is not JSON, naming the file', async () => {
    await writeFile(path.join(dir, 'manifest.json'), '<html>');

    await expect(readCaptureManifest(dir)).rejects.toThrow(
      `${path.join(dir, 'manifest.json')} is not valid JSON`,
    );
  });
});

describe('writeCaptureOutput with mode variants', () => {
  it('names a mode variant id@mode, in file names and the summary', async () => {
    const dark = result('a', { variant: 'dark/rtl', stable: false });
    const written = await writeCaptureOutput(
      path.join(dir, 'out'),
      { ...report, stories: [result('a'), dark] },
      run,
    );

    const files = (await readdir(path.join(dir, 'out'))).sort();
    expect(files).toEqual(['a.png', 'a@dark%2Frtl.png', 'manifest.json']);
    expect(written.stories.map((story) => story.file)).toEqual(['a.png', 'a@dark%2Frtl.png']);
    expect(written.summary.unstable).toEqual(['a@dark/rtl']);
    expect(written.summary.duplicateHashes).toEqual([['a', 'a@dark/rtl']]);
  });
});
