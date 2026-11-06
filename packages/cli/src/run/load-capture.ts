import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { TargusError } from '@targus/core';

import type { CaptureReport, CaptureResult } from '../capture/capture-stories.ts';
import { readCaptureManifest, type StoryRecord } from '../capture/manifest.ts';
import { sha256Hex } from '../capture/png.ts';

async function loadStory(dir: string, record: StoryRecord): Promise<CaptureResult> {
  const { file, ...rest } = record;
  if (file === null) return { ...rest, png: null };
  const png = new Uint8Array(await readFile(path.join(dir, file)));
  const hash = sha256Hex(png);
  if (record.hash !== null && record.hash !== hash) {
    throw new TargusError(
      'bad_request',
      `${file} does not match its manifest hash; the capture in ${dir} was modified`,
    );
  }
  return { ...rest, png, hash };
}

/**
 * Turn a `targus capture` output directory back into the `CaptureReport` the capture loop
 * returned, PNG bytes included, so `targus run --from-capture` skips the simulator.
 */
export async function loadCapture(dir: string): Promise<CaptureReport> {
  const manifest = await readCaptureManifest(dir);
  const stories: CaptureResult[] = [];
  for (const record of manifest.stories) stories.push(await loadStory(dir, record));
  return {
    stories,
    startedAt: manifest.summary.startedAt,
    durationMs: manifest.summary.durationMs,
  };
}
