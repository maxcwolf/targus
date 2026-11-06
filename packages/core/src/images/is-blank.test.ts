import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

import { isBlankPng } from './is-blank.ts';

type Rgba = readonly [number, number, number, number];

/** A solid PNG whose last pixel is optionally painted another colour. */
function makePng(width: number, height: number, fill: Rgba, lastPixel: Rgba = fill): Uint8Array {
  const png = new PNG({ width, height });
  for (let pixel = 0; pixel < width * height; pixel += 1) png.data.set(fill, pixel * 4);
  png.data.set(lastPixel, (width * height - 1) * 4);
  return new Uint8Array(PNG.sync.write(png));
}

const white: Rgba = [255, 255, 255, 255];

describe('isBlankPng', () => {
  it('is true when every pixel matches the first', () => {
    expect(isBlankPng(makePng(8, 8, white))).toBe(true);
    expect(isBlankPng(makePng(1, 1, [0, 0, 0, 255]))).toBe(true);
  });

  it('is false when one pixel differs', () => {
    expect(isBlankPng(makePng(8, 8, white, [0, 0, 0, 255]))).toBe(false);
  });

  it('compares the alpha channel too', () => {
    expect(isBlankPng(makePng(2, 1, white, [255, 255, 255, 0]))).toBe(false);
  });
});
