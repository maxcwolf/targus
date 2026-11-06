import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { imageHash } from '../../test/support/fixtures.ts';
import { createImageRepository } from '../repositories/image.repository.ts';
import { R2ImageStore } from './r2-image-store.ts';

describe('R2ImageStore (local R2 + D1)', () => {
  const metadata = createImageRepository(env.DB);
  const store = new R2ImageStore(env.IMAGES, metadata);

  it('stores bytes under the hash and reads them back', async () => {
    const bytes = new Uint8Array([1, 2, 3]);

    await store.put(imageHash('a'), bytes);

    expect(await store.get(imageHash('a'))).toEqual(bytes);
    const object = await env.IMAGES.head(`images/${imageHash('a')}.png`);
    expect(object?.httpMetadata?.contentType).toBe('image/png');
  });

  it('is idempotent: a second put of the same hash keeps the first bytes', async () => {
    await store.put(imageHash('b'), new Uint8Array([1]));
    await store.put(imageHash('b'), new Uint8Array([2]));

    expect(await store.get(imageHash('b'))).toEqual(new Uint8Array([1]));
  });

  it('returns null for an unknown hash', async () => {
    expect(await store.get(imageHash('c'))).toBeNull();
  });

  it('answers missing() from the images table, not from R2', async () => {
    await store.put(imageHash('d'), new Uint8Array([1]));
    await metadata.record(
      { hash: imageHash('e'), sizeBytes: 1, width: 1, height: 1 },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(await store.missing([imageHash('d'), imageHash('e')])).toEqual([imageHash('d')]);
  });
});
