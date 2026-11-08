import { describe, expect, it } from 'vitest';

import {
  canvasOf,
  outsideOverlapMask,
  overlapOf,
  padTo,
  paintPadding,
  type Bitmap,
} from './padded-canvas.ts';

/** A bitmap whose pixel n (row by row) is [n, n, n, 255], so every pixel is distinguishable. */
function numbered(width: number, height: number): Bitmap {
  const data = new Uint8Array(width * height * 4);
  for (let n = 0; n < width * height; n += 1) data.set([n + 1, n + 1, n + 1, 255], n * 4);
  return { width, height, data };
}

/**
 * The first byte of every pixel as rows, `bytes` bytes per pixel (4 for RGBA, 1 for a mask):
 * enough to see where each pixel went.
 */
function rows(data: Uint8Array, width: number, bytes = 4): number[][] {
  const firsts = Array.from({ length: data.length / bytes }, (_, n) => data[n * bytes] ?? -1);
  return Array.from({ length: firsts.length / width }, (_, y) =>
    firsts.slice(y * width, (y + 1) * width),
  );
}

describe('canvasOf and overlapOf', () => {
  it('take the larger and the smaller of each side, which may come from different images', () => {
    const wide = { width: 5, height: 2 };
    const tall = { width: 3, height: 4 };

    expect(canvasOf(wide, tall)).toEqual({ width: 5, height: 4 });
    expect(canvasOf(tall, wide)).toEqual({ width: 5, height: 4 });
    expect(overlapOf(wide, tall)).toEqual({ width: 3, height: 2 });
    expect(overlapOf(tall, wide)).toEqual({ width: 3, height: 2 });
  });

  it('are the image itself for two images of one size', () => {
    const size = { width: 4, height: 3 };

    expect(canvasOf(size, size)).toEqual(size);
    expect(overlapOf(size, size)).toEqual(size);
  });
});

describe('padTo', () => {
  it('returns the pixels of an image already the canvas size untouched', () => {
    const image = numbered(3, 2);

    expect(padTo(image, { width: 3, height: 2 })).toBe(image.data);
  });

  it('copies each row to the top left and leaves the rest transparent black', () => {
    const padded = padTo(numbered(2, 2), { width: 3, height: 3 });

    expect(rows(padded, 3)).toEqual([
      [1, 2, 0],
      [3, 4, 0],
      [0, 0, 0],
    ]);
    expect([...padded.subarray(2 * 4, 3 * 4)]).toEqual([0, 0, 0, 0]);
  });

  it('pads only the side that is short', () => {
    expect(rows(padTo(numbered(3, 1), { width: 3, height: 2 }), 3)).toEqual([
      [1, 2, 3],
      [0, 0, 0],
    ]);
    expect(rows(padTo(numbered(1, 2), { width: 3, height: 2 }), 3)).toEqual([
      [1, 0, 0],
      [2, 0, 0],
    ]);
  });
});

describe('outsideOverlapMask', () => {
  it('is 0 over the overlap and 1 everywhere else', () => {
    const mask = outsideOverlapMask({ width: 4, height: 3 }, { width: 2, height: 2 });

    expect(rows(mask, 4, 1)).toEqual([
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [1, 1, 1, 1],
    ]);
  });

  it('masks nothing when the overlap is the whole canvas', () => {
    const mask = outsideOverlapMask({ width: 3, height: 2 }, { width: 3, height: 2 });

    expect([...mask]).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('paintPadding', () => {
  const canvas = { width: 3, height: 3 };
  const wide = { width: 3, height: 1 };
  const tall = { width: 1, height: 3 };

  it('paints and counts the pixels exactly one image covers, in either order', () => {
    for (const [a, b] of [
      [wide, tall],
      [tall, wide],
    ] as const) {
      const diff = new Uint8Array(3 * 3 * 4);

      const painted = paintPadding(diff, canvas, a, b, [9, 0, 0]);

      expect(painted).toBe(4);
      expect(rows(diff, 3)).toEqual([
        [0, 9, 9],
        [9, 0, 0],
        [9, 0, 0],
      ]);
    }
  });

  it('writes the colour opaque and leaves pixels both or neither cover as they were', () => {
    const diff = new Uint8Array(3 * 3 * 4).fill(7);

    paintPadding(diff, canvas, wide, tall, [255, 0, 0]);

    expect([...diff.subarray(1 * 4, 2 * 4)]).toEqual([255, 0, 0, 255]);
    expect([...diff.subarray(0, 4)]).toEqual([7, 7, 7, 7]);
    expect([...diff.subarray(8 * 4, 9 * 4)]).toEqual([7, 7, 7, 7]);
  });

  it('paints nothing for two images of the canvas size', () => {
    const diff = new Uint8Array(3 * 3 * 4);

    expect(paintPadding(diff, canvas, canvas, canvas, [255, 0, 0])).toBe(0);
    expect(diff.every((byte) => byte === 0)).toBe(true);
  });
});
