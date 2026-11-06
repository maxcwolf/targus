import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import { decodePng } from './decode-png.ts';

/** Tuning for `diffImages`. Both fields default to pixelmatch's own defaults. */
export interface DiffImagesOptions {
  /**
   * Per-pixel colour distance (0 to 1) below which two pixels count as equal. Smaller is more
   * sensitive. Defaults to 0.1. This is not the per-story failure threshold, which applies to
   * `ratio` (ADR 0003).
   */
  readonly threshold?: number;
  /** Count anti-aliased pixels as differences. Defaults to false, so anti-aliasing is tolerated. */
  readonly includeAntiAliasing?: boolean;
}

/** Outcome of comparing a baseline PNG with the current capture. */
export interface DiffImagesResult {
  /** Dimensions of the compared images, or of the larger one on a size mismatch. */
  readonly width: number;
  readonly height: number;
  readonly differingPixels: number;
  readonly totalPixels: number;
  /** `differingPixels / totalPixels`, from 0 (identical) to 1. */
  readonly ratio: number;
  /** PNG highlighting the differing pixels, or `null` when the sizes differ. */
  readonly diffPng: Uint8Array | null;
  readonly sizeMismatch: boolean;
}

const defaultThreshold = 0.1;

function sizeMismatchResult(baseline: PNG, current: PNG): DiffImagesResult {
  const larger =
    baseline.width * baseline.height >= current.width * current.height ? baseline : current;
  const totalPixels = larger.width * larger.height;
  return {
    width: larger.width,
    height: larger.height,
    differingPixels: totalPixels,
    totalPixels,
    ratio: 1,
    diffPng: null,
    sizeMismatch: true,
  };
}

/**
 * Compare two PNGs with pixelmatch (ADR 0003: diffing runs in the CLI on the CI runner, never in
 * the Worker). Images of different sizes are reported as entirely different, without a diff
 * image, because pixelmatch only compares equally sized bitmaps.
 */
export function diffImages(
  baseline: Uint8Array,
  current: Uint8Array,
  options: DiffImagesOptions = {},
): DiffImagesResult {
  const before = decodePng(baseline);
  const after = decodePng(current);
  if (before.width !== after.width || before.height !== after.height) {
    return sizeMismatchResult(before, after);
  }

  const { width, height } = before;
  const diff = new PNG({ width, height });
  const differingPixels = pixelmatch(before.data, after.data, diff.data, width, height, {
    threshold: options.threshold ?? defaultThreshold,
    includeAA: options.includeAntiAliasing ?? false,
  });
  const totalPixels = width * height;
  return {
    width,
    height,
    differingPixels,
    totalPixels,
    ratio: differingPixels / totalPixels,
    diffPng: new Uint8Array(PNG.sync.write(diff)),
    sizeMismatch: false,
  };
}
