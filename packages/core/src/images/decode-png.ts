import { PNG } from 'pngjs';

/** Decode PNG bytes to an RGBA bitmap. pngjs reads Buffers, so wrap the bytes without copying. */
export function decodePng(png: Uint8Array): PNG {
  return PNG.sync.read(Buffer.from(png.buffer, png.byteOffset, png.byteLength));
}
