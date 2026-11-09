import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { TargusError, type Appearance } from '@targus/core';

import type { CaptureReport, CaptureResult } from '../capture/capture-stories.ts';
import {
  readCaptureManifest,
  type CapturePlatform,
  type StoryRecord,
} from '../capture/manifest.ts';
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

/** A capture directory read back: the report, and the appearance its manifest records. */
export interface LoadedCapture {
  readonly report: CaptureReport;
  /** Null for a capture written before the CLI pinned the appearance (ADR 0035). */
  readonly appearance: Appearance | null;
  /** The platform the capture is for; `ios` for captures written before web capture. */
  readonly platform: CapturePlatform;
  /** The browser of a web capture; null for a simulator capture (its name comes from simctl). */
  readonly deviceName: string | null;
  readonly pixelRatio: number | null;
}

/**
 * Turn a `targus capture` output directory back into the `CaptureReport` the capture loop
 * returned, PNG bytes included, so `targus run --from-capture` skips the simulator.
 */
export async function loadCapture(dir: string): Promise<LoadedCapture> {
  const manifest = await readCaptureManifest(dir);
  const stories: CaptureResult[] = [];
  for (const record of manifest.stories) stories.push(await loadStory(dir, record));
  const report: CaptureReport = {
    stories,
    skipped: manifest.summary.skipped,
    startedAt: manifest.summary.startedAt,
    durationMs: manifest.summary.durationMs,
  };
  const { device, platform, pixelRatio } = manifest.summary;
  return { report, appearance: device.appearance, platform, deviceName: device.name, pixelRatio };
}
