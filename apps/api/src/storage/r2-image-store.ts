import type { ImageStore } from '@targus/core';

import type { ImageRepository } from '../ports/image-repository.ts';

/** R2 object key of an image. Content-addressed, so a key never changes meaning. */
function keyFor(hash: string): string {
  return `images/${hash}.png`;
}

/**
 * `ImageStore` over the `IMAGES` R2 bucket. `missing()` asks the `images` table, not R2, so
 * it is one D1 query; callers record the metadata row (`ImageRepository.record`) after `put`.
 */
export class R2ImageStore implements ImageStore {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly metadata: Pick<ImageRepository, 'missing'>,
  ) {}

  missing(hashes: readonly string[]): Promise<string[]> {
    return this.metadata.missing(hashes);
  }

  async put(hash: string, bytes: Uint8Array): Promise<void> {
    const key = keyFor(hash);
    if ((await this.bucket.head(key)) !== null) return;
    await this.bucket.put(key, bytes, {
      httpMetadata: {
        contentType: 'image/png',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
  }

  async get(hash: string): Promise<Uint8Array | null> {
    const object = await this.bucket.get(keyFor(hash));
    if (object === null) return null;
    return new Uint8Array(await object.arrayBuffer());
  }
}
