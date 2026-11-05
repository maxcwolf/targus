import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CaptureResult } from '../capture/capture-stories.js';
import { writeCaptureOutput } from '../capture/manifest.js';
import { sha256Hex } from '../capture/png.js';
import { encodeSolidPng } from '../capture/solid-png.fake.js';
import { loadCapture } from './load-capture.js';

const png = encodeSolidPng(2, 2, [1, 2, 3, 255]);
const base: CaptureResult = {
  id: 'a--ok',
  title: 'A',
  name: 'Ok',
  png,
  hash: sha256Hex(png),
  width: 2,
  height: 2,
  renderMs: 1,
  captureMs: 2,
  attempts: 1,
  stable: true,
  blank: true,
  error: null,
};
const run = {
  udid: 'SIM',
  bundleId: 'co.example',
  appPath: null,
  settleMs: 300,
  stabilityGapMs: 150,
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'targus-load-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadCapture', () => {
  it('reads PNG bytes back and keeps errored stories without an image', async () => {
    const errored = { ...base, id: 'b--broken', png: null, hash: null, error: 'boom' };
    const report = {
      stories: [base, errored],
      startedAt: '2026-11-04T10:00:00.000Z',
      durationMs: 9,
    };
    await writeCaptureOutput(dir, report, run);

    expect(await loadCapture(dir)).toEqual(report);
  });

  it('rejects a PNG that no longer matches its manifest hash', async () => {
    await writeCaptureOutput(
      dir,
      { stories: [base], startedAt: '2026-11-04T10:00:00.000Z', durationMs: 1 },
      run,
    );
    await writeFile(path.join(dir, 'a--ok.png'), encodeSolidPng(2, 2, [9, 9, 9, 255]));

    await expect(loadCapture(dir)).rejects.toThrow('does not match its manifest hash');
  });
});
