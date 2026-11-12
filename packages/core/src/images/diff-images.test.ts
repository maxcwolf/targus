import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

import { decodePng } from './decode-png.ts';
import { diffImages } from './diff-images.ts';

type Rgba = readonly [number, number, number, number];

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: Rgba;
}

const white: Rgba = [255, 255, 255, 255];
const black: Rgba = [0, 0, 0, 255];

/** Encode a solid PNG, optionally with filled rectangles painted over it. */
function makePng(width: number, height: number, background: Rgba, rects: Rect[] = []): Uint8Array {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const rect = rects.find(
        (r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height,
      );
      png.data.set(rect?.color ?? background, (y * width + x) * 4);
    }
  }
  return new Uint8Array(PNG.sync.write(png));
}

describe('diffImages', () => {
  it('reports no difference for identical images', () => {
    const image = makePng(20, 10, white);

    const result = diffImages(image, makePng(20, 10, white));

    expect(result).toMatchObject({
      width: 20,
      height: 10,
      differingPixels: 0,
      totalPixels: 200,
      ratio: 0,
      sizeMismatch: false,
    });
    const diff = decodePng(result.diffPng);
    expect([diff.width, diff.height]).toEqual([20, 10]);
  });

  it('counts the pixels of one changed rectangle and emits a diff PNG of the same size', () => {
    const baseline = makePng(20, 20, white);
    const current = makePng(20, 20, white, [{ x: 4, y: 4, width: 5, height: 3, color: black }]);

    const result = diffImages(baseline, current);

    expect(result.differingPixels).toBe(15);
    expect(result.sizeMismatch).toBe(false);
    const diff = decodePng(result.diffPng);
    expect([diff.width, diff.height]).toEqual([20, 20]);
    // pixelmatch paints differing pixels red by default.
    expect([...diff.data.subarray((5 * 20 + 5) * 4, (5 * 20 + 5) * 4 + 4)]).toEqual([
      255, 0, 0, 255,
    ]);
  });

  it('reports ratio as differing pixels over total pixels', () => {
    const baseline = makePng(10, 10, white);
    const current = makePng(10, 10, white, [{ x: 0, y: 0, width: 10, height: 2, color: black }]);

    const result = diffImages(baseline, current);

    expect(result.ratio).toBe(result.differingPixels / result.totalPixels);
    expect(result.ratio).toBe(0.2);
  });
});

describe('diffImages options and inputs', () => {
  it('honours the colour threshold', () => {
    const grey: Rgba = [250, 250, 250, 255];
    const baseline = makePng(10, 10, white);
    const current = makePng(10, 10, white, [{ x: 0, y: 0, width: 10, height: 1, color: grey }]);

    expect(diffImages(baseline, current).differingPixels).toBe(0);
    expect(diffImages(baseline, current, { threshold: 0 }).differingPixels).toBe(10);
  });

  it('sees one shade of a colour by default, which pixelmatch’s own 0.1 does not', () => {
    const baseline = makePng(10, 10, [37, 99, 235, 255]);
    const current = makePng(10, 10, [29, 78, 216, 255]);

    expect(diffImages(baseline, current).differingPixels).toBe(100);
    expect(diffImages(baseline, current, { threshold: 0.1 }).differingPixels).toBe(0);
  });

  it('accepts a Uint8Array view that does not start at offset 0', () => {
    const image = makePng(4, 4, white);
    const padded = new Uint8Array(image.length + 3);
    padded.set(image, 3);

    expect(diffImages(padded.subarray(3), image).differingPixels).toBe(0);
  });

  it('can count anti-aliased pixels when asked to', () => {
    // A one-pixel grey line between black and white reads as anti-aliasing to pixelmatch.
    const grey: Rgba = [128, 128, 128, 255];
    const baseline = makePng(9, 9, white, [{ x: 0, y: 0, width: 4, height: 9, color: black }]);
    const current = makePng(9, 9, white, [
      { x: 0, y: 0, width: 4, height: 9, color: black },
      { x: 4, y: 0, width: 1, height: 9, color: grey },
    ]);

    const tolerant = diffImages(baseline, current);
    const strict = diffImages(baseline, current, { includeAntiAliasing: true });

    expect(strict.differingPixels).toBeGreaterThan(tolerant.differingPixels);
  });
});
