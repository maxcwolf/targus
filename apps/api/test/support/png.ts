import { sha256Hex } from '../../src/lib/sha256.ts';

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array([...new TextEncoder().encode(type), ...data]);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc32(body));
  return out;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A valid solid-colour RGB PNG, so different `grey` values give different hashes. */
export async function makePng(width: number, height: number, grey: number): Promise<Uint8Array> {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = [0, ...Array.from({ length: width * 3 }, () => grey)];
  const raw = new Uint8Array(Array.from({ length: height }, () => row).flat());
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', await deflate(raw)),
    chunk('IEND', new Uint8Array()),
  ];
  return new Uint8Array(parts.flatMap((part) => [...part]));
}

/** A PNG and its content hash. */
export async function pngFixture(
  width: number,
  height: number,
  grey: number,
): Promise<{ bytes: Uint8Array; hash: string }> {
  const bytes = await makePng(width, height, grey);
  return { bytes, hash: await sha256Hex(bytes) };
}
