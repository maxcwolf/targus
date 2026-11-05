import { describe, expect, it } from 'vitest';

import { imageHash } from '../../test/support/fixtures.js';
import { createTestDeps } from '../../test/support/in-memory.js';
import { pngFixture } from '../../test/support/png.js';
import { getImage, uploadImage } from './image.service.js';

describe('uploadImage', () => {
  it('stores a PNG under its hash and records its size and dimensions', async () => {
    const deps = createTestDeps();
    const png = await pngFixture(3, 2, 10);

    expect(await uploadImage(deps, png.hash, png.bytes)).toEqual({ hash: png.hash, stored: true });
    expect(deps.images.records.get(png.hash)).toEqual({
      hash: png.hash,
      sizeBytes: png.bytes.length,
      width: 3,
      height: 2,
      lastReferencedAt: deps.clock.now(),
    });
    expect(await getImage(deps, png.hash)).toEqual(png.bytes);
  });

  it('is idempotent and touches an image it already has', async () => {
    const deps = createTestDeps();
    const png = await pngFixture(1, 1, 20);
    await uploadImage(deps, png.hash, png.bytes);
    deps.clock.advance(1000);

    expect(await uploadImage(deps, png.hash, png.bytes)).toEqual({ hash: png.hash, stored: false });
    expect(deps.images.records.get(png.hash)?.lastReferencedAt).toEqual(deps.clock.now());
  });

  it('rejects a body whose sha256 is not the path hash', async () => {
    const png = await pngFixture(1, 1, 30);

    await expect(uploadImage(createTestDeps(), imageHash('a'), png.bytes)).rejects.toThrow(
      'body sha256 does not match the path hash',
    );
  });

  it('rejects bodies that are not PNGs and malformed hashes', async () => {
    const deps = createTestDeps();
    const png = await pngFixture(1, 1, 40);

    await expect(uploadImage(deps, imageHash('a'), new Uint8Array(40))).rejects.toThrow(
      'body is not a PNG',
    );
    await expect(uploadImage(deps, 'NOT-A-HASH', png.bytes)).rejects.toMatchObject({
      code: 'bad_request',
    });
  });
});

describe('getImage', () => {
  it('answers not_found for an unknown hash', async () => {
    await expect(getImage(createTestDeps(), imageHash('f'))).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
