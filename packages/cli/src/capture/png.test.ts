import { describe, expect, it } from 'vitest';

import { compareWithCore } from './compare-images.js';
import { readPngSize, sha256Hex } from './png.js';
import { encodeSolidPng } from './solid-png.fake.js';

const white = [255, 255, 255, 255] as const;
const black = [0, 0, 0, 255] as const;

describe('readPngSize', () => {
  it('reads width and height from the IHDR chunk', () => {
    expect(readPngSize(encodeSolidPng(1179, 2556, white))).toEqual({ width: 1179, height: 2556 });
  });

  it('honours a view into a larger buffer', () => {
    const png = encodeSolidPng(3, 2, white);
    const padded = new Uint8Array(png.length + 5);
    padded.set(png, 5);

    expect(readPngSize(padded.subarray(5))).toEqual({ width: 3, height: 2 });
  });

  it('names an empty screenshot instead of calling it not a PNG', () => {
    expect(() => readPngSize(new Uint8Array(0))).toThrow('screenshot is empty (0 bytes)');
  });

  it('rejects bytes that are not a PNG', () => {
    expect(() => readPngSize(new Uint8Array(30))).toThrow('not a PNG');
    expect(() => readPngSize(encodeSolidPng(2, 2, white).subarray(0, 20))).toThrow('not a PNG');
  });
});

describe('sha256Hex', () => {
  it('hashes bytes to lowercase hex', () => {
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('compareWithCore', () => {
  it('reports the changed-pixel ratio and a diff image from core diffImages', () => {
    const baseline = encodeSolidPng(4, 4, white);
    const current = encodeSolidPng(4, 4, white, { x: 1, y: 1, color: black });

    const same = compareWithCore(baseline, encodeSolidPng(4, 4, white));
    const changed = compareWithCore(baseline, current);

    expect(same.ratio).toBe(0);
    expect(changed.ratio).toBe(1 / 16);
    expect(changed.diffPng).not.toBeNull();
  });
});
