import { decodePng } from './decode-png.ts';

const bytesPerPixel = 4;

/**
 * True when every pixel of the PNG equals the first one (RGBA), e.g. a white screen captured
 * before the story rendered. The CLI reports it as `blank` so a reviewer can spot it.
 */
export function isBlankPng(png: Uint8Array): boolean {
  const { data } = decodePng(png);
  for (let offset = bytesPerPixel; offset < data.length; offset += 1) {
    if (data[offset] !== data[offset % bytesPerPixel]) return false;
  }
  return true;
}
