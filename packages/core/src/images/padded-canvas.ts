/**
 * The geometry of diffing two images of different sizes (ADR 0003, plan.md 5.7): both are
 * anchored top left on a canvas as wide as the wider and as tall as the taller.
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** RGBA pixels, row by row, as pngjs decodes them. */
export interface Bitmap extends Size {
  readonly data: Uint8Array;
}

export type Rgb = readonly [number, number, number];

/** The canvas both images are diffed on: the larger width and the larger height. */
export function canvasOf(a: Size, b: Size): Size {
  return { width: Math.max(a.width, b.width), height: Math.max(a.height, b.height) };
}

/** The top-left area both images cover: the smaller width and the smaller height. */
export function overlapOf(a: Size, b: Size): Size {
  return { width: Math.min(a.width, b.width), height: Math.min(a.height, b.height) };
}

/**
 * `image`'s pixels on a transparent black canvas of `canvas` size, anchored top left. An image
 * already the canvas size is returned as it is.
 */
export function padTo(image: Bitmap, canvas: Size): Uint8Array {
  if (image.width === canvas.width && image.height === canvas.height) return image.data;
  const padded = new Uint8Array(canvas.width * canvas.height * 4);
  const rowBytes = image.width * 4;
  for (let y = 0; y < image.height; y += 1) {
    padded.set(image.data.subarray(y * rowBytes, (y + 1) * rowBytes), y * canvas.width * 4);
  }
  return padded;
}

/**
 * One byte per canvas pixel, 1 outside `overlap` and 0 inside it: pixelmatch's `ignoreMask`,
 * so only the area both images cover is compared colour by colour.
 */
export function outsideOverlapMask(canvas: Size, overlap: Size): Uint8Array {
  const mask = new Uint8Array(canvas.width * canvas.height).fill(1);
  for (let y = 0; y < overlap.height; y += 1) {
    mask.fill(0, y * canvas.width, y * canvas.width + overlap.width);
  }
  return mask;
}

/**
 * Paint every canvas pixel that exactly one of `a` and `b` covers in `color`, in the RGBA
 * `diff` of `canvas` size, and return how many there were. Pixels both cover, or neither, are
 * left alone. Padding never goes through pixelmatch, so it counts as changed whatever colour
 * the real pixel has.
 */
export function paintPadding(diff: Uint8Array, canvas: Size, a: Size, b: Size, color: Rgb): number {
  const covers = (image: Size, x: number, y: number): boolean =>
    x < image.width && y < image.height;
  let painted = 0;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (covers(a, x, y) !== covers(b, x, y)) {
        diff.set([...color, 255], (y * canvas.width + x) * 4);
        painted += 1;
      }
    }
  }
  return painted;
}
