import { crc32, deflateSync } from 'node:zlib';

/** RGBA, 0 to 255 each. */
export type Rgba = readonly [number, number, number, number];

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encode a valid 8-bit RGBA PNG whose pixel at (x, y) is `pixelAt(x, y)`, for tests and fixtures. */
export function encodeRgbaPng(
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => Rgba,
): Uint8Array {
  const rowLength = 1 + width * 4;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) raw.set(pixelAt(x, y), y * rowLength + 1 + x * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit depth, RGBA, deflate, no filter, no interlace
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Uint8Array(
    Buffer.concat([
      signature,
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', new Uint8Array()),
    ]),
  );
}

/**
 * Encode a valid single-colour RGBA PNG for tests, optionally with one pixel changed. Real
 * screenshots are too large to keep as fixtures; this keeps cli free of a PNG encoder dependency.
 */
export function encodeSolidPng(
  width: number,
  height: number,
  color: Rgba,
  changedPixel?: { readonly x: number; readonly y: number; readonly color: Rgba },
): Uint8Array {
  return encodeRgbaPng(width, height, (x, y) =>
    changedPixel?.x === x && changedPixel.y === y ? changedPixel.color : color,
  );
}
