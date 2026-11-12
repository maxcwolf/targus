import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import { decodePng } from './decode-png.ts';
import {
  canvasOf,
  outsideOverlapMask,
  overlapOf,
  padTo,
  paintPadding,
  type Rgb,
} from './padded-canvas.ts';

/** Tuning for `diffImages`. */
export interface DiffImagesOptions {
  /**
   * Per-pixel colour distance (0 to 1) below which two pixels count as equal. Smaller is more
   * sensitive. Defaults to 0.063, which is Chromatic's default: pixelmatch's own 0.1 misses a
   * restyle such as a button going one shade darker. This is not the per-story failure
   * threshold, which applies to `ratio` (ADR 0003).
   */
  readonly threshold?: number;
  /** Count anti-aliased pixels as differences. Defaults to false, so anti-aliasing is tolerated. */
  readonly includeAntiAliasing?: boolean;
}

/** Outcome of comparing a baseline PNG with the current capture. */
export interface DiffImagesResult {
  /**
   * Dimensions of the compared canvas: the images' own size, or on a size mismatch the larger
   * width and the larger height, which may come from different images.
   */
  readonly width: number;
  readonly height: number;
  readonly differingPixels: number;
  /** `width * height`, the area of the canvas. */
  readonly totalPixels: number;
  /** `differingPixels / totalPixels`, from 0 (identical) to 1. */
  readonly ratio: number;
  /** PNG of the canvas size highlighting the differing pixels in red. */
  readonly diffPng: Uint8Array;
  /** The two images differ in width or height, so the diff ran on a padded canvas. */
  readonly sizeMismatch: boolean;
}

const defaultThreshold = 0.063;
/** pixelmatch's default colour for a differing pixel, also used to paint the padding. */
const diffColor: Rgb = [255, 0, 0];

/**
 * Compare two PNGs with pixelmatch (ADR 0003: diffing runs in the CLI on the CI runner, never in
 * the Worker). Images of different sizes are padded onto a canvas as wide as the wider and as
 * tall as the taller, anchored top left. The area both images cover is diffed as usual; every
 * pixel only one image covers counts as changed; pixels neither covers count as unchanged. The
 * ratio is over the whole canvas, so a component that grows by a few pixels reads as a small
 * change with a diff image, not as 100% changed.
 */
export function diffImages(
  baseline: Uint8Array,
  current: Uint8Array,
  options: DiffImagesOptions = {},
): DiffImagesResult {
  const before = decodePng(baseline);
  const after = decodePng(current);
  const canvas = canvasOf(before, after);
  const sizeMismatch = before.width !== after.width || before.height !== after.height;

  const { width, height } = canvas;
  const diff = new PNG({ width, height });
  const matched = pixelmatch(
    padTo(before, canvas),
    padTo(after, canvas),
    diff.data,
    width,
    height,
    {
      threshold: options.threshold ?? defaultThreshold,
      includeAA: options.includeAntiAliasing ?? false,
      diffColor: [...diffColor],
      ignoreMask: sizeMismatch ? outsideOverlapMask(canvas, overlapOf(before, after)) : undefined,
    },
  );
  const padding = sizeMismatch ? paintPadding(diff.data, canvas, before, after, diffColor) : 0;
  const differingPixels = matched + padding;
  const totalPixels = width * height;
  return {
    width,
    height,
    differingPixels,
    totalPixels,
    ratio: differingPixels / totalPixels,
    diffPng: new Uint8Array(PNG.sync.write(diff)),
    sizeMismatch,
  };
}
