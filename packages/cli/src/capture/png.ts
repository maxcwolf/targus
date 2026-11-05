import { createHash } from 'node:crypto';

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// 8-byte signature, then the IHDR chunk: length (4), type (4), width (4), height (4).
const widthOffset = 16;
const heightOffset = 20;

export interface PngSize {
  readonly width: number;
  readonly height: number;
}

/** Read width and height from a PNG's IHDR chunk without decoding it. */
export function readPngSize(png: Uint8Array): PngSize {
  const isPng =
    png.length >= heightOffset + 4 && pngSignature.every((byte, index) => png[index] === byte);
  if (!isPng) throw new Error('screenshot is not a PNG');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(widthOffset), height: view.getUint32(heightOffset) };
}

/** SHA-256 hex of the bytes: the content address every PNG is stored under (plan.md 5.1). */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
