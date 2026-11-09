import fc from 'fast-check';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

import { decodePng } from './decode-png.ts';
import { diffImages } from './diff-images.ts';

type Rgba = readonly [number, number, number, number];

interface Bitmap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

const white: Rgba = [255, 255, 255, 255];
const black: Rgba = [0, 0, 0, 255];
const clear: Rgba = [0, 0, 0, 0];
const red = [255, 0, 0, 255];

function encode({ width, height, data }: Bitmap): Uint8Array {
  const png = new PNG({ width, height });
  png.data.set(data);
  return new Uint8Array(PNG.sync.write(png));
}

/** Encode a PNG whose every pixel comes from `colorAt`. */
function paint(width: number, height: number, colorAt: (x: number, y: number) => Rgba): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(colorAt(x, y), (y * width + x) * 4);
  }
  return encode({ width, height, data });
}

const solid = (width: number, height: number, color: Rgba): Uint8Array =>
  paint(width, height, () => color);

function pixelAt(png: Uint8Array, x: number, y: number): number[] {
  const image = decodePng(png);
  const at = (y * image.width + x) * 4;
  return [...image.data.subarray(at, at + 4)];
}

type Size = readonly [number, number];

interface SizeExample {
  readonly name: string;
  readonly baseline: Size;
  readonly current: Size;
  readonly canvas: Size;
  readonly padding: number;
}

const sizeExamples: readonly SizeExample[] = [
  { name: 'wider', baseline: [10, 10], current: [12, 10], canvas: [12, 10], padding: 20 },
  { name: 'taller', baseline: [10, 10], current: [10, 13], canvas: [10, 13], padding: 30 },
  { name: 'both', baseline: [10, 10], current: [12, 13], canvas: [12, 13], padding: 56 },
  { name: 'smaller', baseline: [12, 13], current: [10, 10], canvas: [12, 13], padding: 56 },
];

describe('diffImages on images of different sizes', () => {
  it.each(sizeExamples)('counts only the padding when the current image is $name', (example) => {
    const [width, height] = example.canvas;

    const result = diffImages(solid(...example.baseline, white), solid(...example.current, white));

    expect(result).toMatchObject({
      width,
      height,
      differingPixels: example.padding,
      totalPixels: width * height,
      ratio: example.padding / (width * height),
      sizeMismatch: true,
    });
    const diff = decodePng(result.diffPng);
    expect([diff.width, diff.height]).toEqual([width, height]);
    expect(pixelAt(result.diffPng, width - 1, height - 1)).toEqual(red);
    expect(pixelAt(result.diffPng, 0, 0)).not.toEqual(red);
  });

  it('leaves the corner neither image covers unchanged when one is wider and the other taller', () => {
    const result = diffImages(solid(10, 20, white), solid(20, 10, white));

    expect(result).toMatchObject({ width: 20, height: 20, differingPixels: 200, ratio: 0.5 });
    expect(pixelAt(result.diffPng, 15, 5)).toEqual(red);
    expect(pixelAt(result.diffPng, 5, 15)).toEqual(red);
    expect(pixelAt(result.diffPng, 15, 15)).not.toEqual(red);
  });

  it('counts padding against content of the padding colour, transparent black', () => {
    const result = diffImages(solid(2, 2, clear), solid(3, 2, clear));

    expect(result.differingPixels).toBe(2);
    expect(pixelAt(result.diffPng, 2, 0)).toEqual(red);
  });

  it('adds changes inside the shared area to the padding', () => {
    const current = paint(12, 10, (x, y) => (x === 4 && y === 4 ? black : white));

    const result = diffImages(solid(10, 10, white), current);

    expect(result.differingPixels).toBe(21);
    expect(pixelAt(result.diffPng, 4, 4)).toEqual(red);
  });

  it('applies the colour threshold to the shared area but not to the padding', () => {
    const nearWhite: Rgba = [250, 250, 250, 255];

    const result = diffImages(solid(10, 10, white), solid(11, 10, nearWhite));

    expect(result.differingPixels).toBe(10);
  });
});

const sideArb = fc.integer({ min: 1, max: 6 });

function bitmapArb(width: number, height: number): fc.Arbitrary<Bitmap> {
  const length = width * height * 4;
  return fc
    .uint8Array({ minLength: length, maxLength: length })
    .map((data) => ({ width, height, data }));
}

const anyBitmapArb = fc
  .tuple(sideArb, sideArb)
  .chain(([width, height]) => bitmapArb(width, height));

/** A bitmap and a larger one whose top-left corner holds the same pixels. */
const extendedPairArb = fc
  .record({
    width: sideArb,
    height: sideArb,
    extraWidth: fc.integer({ min: 0, max: 4 }),
    extraHeight: fc.integer({ min: 0, max: 4 }),
  })
  .chain(({ width, height, extraWidth, extraHeight }) =>
    fc.tuple(bitmapArb(width, height), bitmapArb(width + extraWidth, height + extraHeight)),
  )
  .map(([small, large]) => {
    const data = Uint8Array.from(large.data);
    for (let y = 0; y < small.height; y += 1) {
      const row = small.data.subarray(y * small.width * 4, (y + 1) * small.width * 4);
      data.set(row, y * large.width * 4);
    }
    return { small, large: { ...large, data } };
  });

describe('diffImages properties', () => {
  it('diffs any two images on a canvas of the larger width and height', () => {
    fc.assert(
      fc.property(anyBitmapArb, anyBitmapArb, (a, b) => {
        const result = diffImages(encode(a), encode(b));

        const width = Math.max(a.width, b.width);
        const height = Math.max(a.height, b.height);
        const overlap = Math.min(a.width, b.width) * Math.min(a.height, b.height);
        const padding = a.width * a.height + b.width * b.height - 2 * overlap;
        const diff = decodePng(result.diffPng);
        expect([result.width, result.height, diff.width, diff.height]).toEqual([
          width,
          height,
          width,
          height,
        ]);
        expect(result.totalPixels).toBe(width * height);
        expect(result.ratio).toBe(result.differingPixels / result.totalPixels);
        expect(result.sizeMismatch).toBe(a.width !== b.width || a.height !== b.height);
        expect(result.differingPixels).toBeGreaterThanOrEqual(padding);
        expect(result.differingPixels).toBeLessThanOrEqual(padding + overlap);
      }),
    );
  });

  it('counts exactly the padding when the shared area is identical, in either order', () => {
    fc.assert(
      fc.property(extendedPairArb, ({ small, large }) => {
        const padding = large.width * large.height - small.width * small.height;

        const grown = diffImages(encode(small), encode(large));
        const shrunk = diffImages(encode(large), encode(small));

        expect(grown.differingPixels).toBe(padding);
        expect(shrunk.differingPixels).toBe(padding);
        expect(grown.sizeMismatch).toBe(padding > 0);
      }),
    );
  });
});
