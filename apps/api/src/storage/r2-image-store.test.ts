import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { describeImageStoreContract } from '../../test/support/contracts/image-store.contract.ts';
import { imageHash } from '../../test/support/fixtures.ts';
import {
  createInMemoryMemberships,
  createInMemoryUsers,
} from '../../test/support/in-memory-auth.ts';
import { createInMemoryImages } from '../../test/support/in-memory-images.ts';
import { createInMemoryProjects } from '../../test/support/in-memory.ts';
import { createImageRepository } from '../repositories/image.repository.ts';
import { R2ImageStore } from './r2-image-store.ts';

const at = new Date('2026-01-01T00:00:00.000Z');

describeImageStoreContract('R2ImageStore (local R2 + D1)', () => {
  const metadata = createImageRepository(env.DB);
  return {
    store: new R2ImageStore(env.IMAGES, metadata),
    record: (hash) => metadata.record({ hash, sizeBytes: 1, width: 1, height: 1 }, at),
  };
});

describeImageStoreContract('in-memory images double', () => {
  const projects = createInMemoryProjects();
  const memberships = createInMemoryMemberships({ users: createInMemoryUsers(), orgs: projects });
  const images = createInMemoryImages({ projects, memberships });
  return {
    store: images,
    record: (hash) => images.record({ hash, sizeBytes: 1, width: 1, height: 1 }, at),
  };
});

describe('R2ImageStore objects (local R2)', () => {
  it('stores each image as an immutable PNG', async () => {
    const store = new R2ImageStore(env.IMAGES, createImageRepository(env.DB));

    await store.put(imageHash('a'), new Uint8Array([1, 2, 3]));

    const object = await env.IMAGES.head(`images/${imageHash('a')}.png`);
    expect(object?.httpMetadata).toEqual({
      contentType: 'image/png',
      cacheControl: 'public, max-age=31536000, immutable',
    });
  });
});
