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

interface Size {
  readonly width: number;
  readonly height: number;
}

const defaultThreshold = 0.1;
/** pixelmatch's default colour for a differing pixel, also used to paint the padding. */
const diffColor: [number, number, number] = [255, 0, 0];

/** Copy `image` onto a transparent black canvas of `canvas` size, anchored top left. */
function padTo(image: PNG, canvas: Size): Uint8Array {
  if (image.width === canvas.width && image.height === canvas.height) return image.data;
  const padded = new Uint8Array(canvas.width * canvas.height * 4);
  const rowBytes = image.width * 4;
  for (let y = 0; y < image.height; y += 1) {
    padded.set(image.data.subarray(y * rowBytes, (y + 1) * rowBytes), y * canvas.width * 4);
  }
  return padded;
}

/** One byte per canvas pixel: 1 outside the area both images cover, which pixelmatch skips. */
function outsideOverlap(canvas: Size, overlap: Size): Uint8Array {
  const mask = new Uint8Array(canvas.width * canvas.height).fill(1);
  for (let y = 0; y < overlap.height; y += 1) {
    mask.fill(0, y * canvas.width, y * canvas.width + overlap.width);
  }
  return mask;
}

const covers = (image: Size, x: number, y: number): boolean => x < image.width && y < image.height;

/**
 * Paint every canvas pixel that only one image covers as changed, and count them. Padding never
 * goes through pixelmatch, so it counts as changed whatever colour the real pixel has.
 */
function paintPadding(diff: Uint8Array, canvas: Size, a: Size, b: Size): number {
  let painted = 0;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (covers(a, x, y) !== covers(b, x, y)) {
        diff.set([...diffColor, 255], (y * canvas.width + x) * 4);
        painted += 1;
      }
    }
  }
  return painted;
}

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
  const canvas = {
    width: Math.max(before.width, after.width),
    height: Math.max(before.height, after.height),
  };
  const overlap = {
    width: Math.min(before.width, after.width),
    height: Math.min(before.height, after.height),
  };
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
      diffColor,
      ignoreMask: sizeMismatch ? outsideOverlap(canvas, overlap) : undefined,
    },
  );
  const padding = sizeMismatch ? paintPadding(diff.data, canvas, before, after) : 0;
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
