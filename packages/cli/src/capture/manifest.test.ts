import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CaptureReport, CaptureResult } from './capture-stories.js';
import {
  buildManifest,
  perStoryStats,
  readCaptureManifest,
  writeCaptureOutput,
  type CaptureRunInfo,
} from './manifest.js';

const run: CaptureRunInfo = {
  udid: 'SIM',
  bundleId: 'co.example',
  appPath: '/apps/Example.app',
  settleMs: 300,
  stabilityGapMs: 150,
};

function result(id: string, overrides: Partial<CaptureResult> = {}): CaptureResult {
  return {
    id,
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
      device: { udid: 'SIM' },
      app: { bundleId: 'co.example', path: '/apps/Example.app' },
      settleMs: 300,
      stabilityGapMs: 150,
      storyCount: 4,
      captured: 3,
      failed: 1,
      unstable: ['b'],
      blank: ['d'],
      duplicateHashes: [['a', 'd']],
      startedAt: '2026-11-04T10:00:00.000Z',
      durationMs: 4200,
      perStoryMs: { mean: 2000, median: 1100, p90: 4000, max: 4000 },
    });
    expect(manifest.stories.map((story) => story.file)).toEqual(['a.png', 'b.png', null, 'd.png']);
    expect(manifest.stories[0]).not.toHaveProperty('png');
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
