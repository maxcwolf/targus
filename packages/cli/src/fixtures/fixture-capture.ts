import { isBlankPng, type Appearance } from '@targus/core';

import type { CaptureReport, CaptureResult } from '../capture/capture-stories.ts';
import { writeCaptureOutput, type CaptureManifest } from '../capture/manifest.ts';
import { readPngSize, sha256Hex } from '../capture/png.ts';
import { encodeRgbaPng, encodeSolidPng } from '../capture/solid-png.fake.ts';

const width = 24;
const height = 48;

function story(id: string, title: string, name: string, png: Uint8Array): CaptureResult {
  return {
    id,
    variant: 'default',
    title,
    name,
    png,
    hash: sha256Hex(png),
    ...readPngSize(png),
    renderMs: 10,
    captureMs: 500,
    attempts: 1,
    stable: true,
    blank: isBlankPng(png),
    error: null,
  };
}

/**
 * `base` is the fixture as first captured; `changed` repaints the red story so a build from it
 * has one `changed` story against a `base` baseline and two `unchanged` ones.
 */
export type FixtureCaptureVariant = 'base' | 'changed';

/**
 * A tiny, deterministic three-story capture (two solid colours and a gradient) for tests and the
 * e2e suite, generated rather than committed as binaries.
 */
export function fixtureCaptureReport(variant: FixtureCaptureVariant = 'base'): CaptureReport {
  const red: [number, number, number, number] =
    variant === 'changed' ? [120, 40, 160, 255] : [220, 40, 40, 255];
  const gradient = encodeRgbaPng(width, height, (x, y) => [
    Math.round((x / (width - 1)) * 255),
    Math.round((y / (height - 1)) * 255),
    128,
    255,
  ]);
  return {
    stories: [
      story('fixture-solid--red', 'Fixture/Solid', 'Red', encodeSolidPng(width, height, red)),
      story(
        'fixture-solid--blue',
        'Fixture/Solid',
        'Blue',
        encodeSolidPng(width, height, [40, 80, 220, 255]),
      ),
      story('fixture-gradient--default', 'Fixture/Gradient', 'Default', gradient),
    ],
    skipped: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 1500,
  };
}

/** Write the fixture capture to `dir` as `targus capture` would: PNGs plus `manifest.json`. */
export async function writeFixtureCapture(
  dir: string,
  variant: FixtureCaptureVariant = 'base',
  appearance: Appearance = 'light',
): Promise<CaptureManifest> {
  return writeCaptureOutput(dir, fixtureCaptureReport(variant), {
    platform: 'ios',
    udid: 'FIXTURE',
    appearance,
    bundleId: 'dev.targus.fixture',
    appPath: null,
    settleMs: 300,
    stabilityGapMs: 150,
  });
}
