import { TargusError } from '@targus/core';

const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Signature (8) + IHDR length (4) + "IHDR" (4) + width (4) + height (4). */
const headerLength = 24;

/**
 * Check the PNG signature and read width and height from the IHDR chunk, which the format
 * requires to come first. Throws `bad_request` for anything that is not a PNG.
 */
export function readPngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const isPng =
    bytes.length >= headerLength &&
    signature.every((byte, index) => bytes[index] === byte) &&
    String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR';
  if (!isPng) throw new TargusError('bad_request', 'body is not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) throw new TargusError('bad_request', 'PNG has no pixels');
  return { width, height };
}
