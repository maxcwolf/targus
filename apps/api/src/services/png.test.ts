import { describe, expect, it } from 'vitest';

import { makePng } from '../../test/support/png.ts';
import { readPngDimensions } from './png.ts';

describe('readPngDimensions', () => {
  it('reads width and height from IHDR', async () => {
    expect(readPngDimensions(await makePng(7, 5, 0))).toEqual({ width: 7, height: 5 });
  });

  it('rejects short bodies, a wrong signature and a missing IHDR', async () => {
    const png = await makePng(1, 1, 0);
    const badSignature = png.slice();
    badSignature[1] = 0;
    const noIhdr = png.slice();
    noIhdr[12] = 0x58;

    expect(() => readPngDimensions(png.subarray(0, 10))).toThrow('body is not a PNG');
    expect(() => readPngDimensions(badSignature)).toThrow('body is not a PNG');
    expect(() => readPngDimensions(noIhdr)).toThrow('body is not a PNG');
  });

  it('rejects a zero-sized image', async () => {
    const png = await makePng(1, 1, 0);
    new DataView(png.buffer).setUint32(16, 0);

    expect(() => readPngDimensions(png)).toThrow('PNG has no pixels');
  });
});
