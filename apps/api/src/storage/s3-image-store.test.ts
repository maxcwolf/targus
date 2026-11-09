import { describe, expect, it } from 'vitest';

import { describeImageStoreContract } from '../../test/support/contracts/image-store.contract.ts';
import { imageHash } from '../../test/support/fixtures.ts';
import {
  createInMemoryMemberships,
  createInMemoryUsers,
} from '../../test/support/in-memory-auth.ts';
import { createInMemoryImages } from '../../test/support/in-memory-images.ts';
import { createInMemoryProjects } from '../../test/support/in-memory.ts';
import { createS3Fake } from '../../test/support/s3-fake.ts';
import type { S3Config } from '../config.ts';
import { S3ImageStore, s3ObjectUrl } from './s3-image-store.ts';

const at = new Date('2026-01-01T00:00:00.000Z');

const config: S3Config = {
  endpoint: 'https://s3.eu-west-1.amazonaws.com',
  region: 'eu-west-1',
  bucket: 'targus-images',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  forcePathStyle: false,
};

const minio: S3Config = { ...config, endpoint: 'http://localhost:9000/', forcePathStyle: true };

function metadataStore() {
  const projects = createInMemoryProjects();
  const memberships = createInMemoryMemberships({ users: createInMemoryUsers(), orgs: projects });
  return createInMemoryImages({ projects, memberships });
}

describeImageStoreContract('S3ImageStore (in-memory S3 behind fetch)', () => {
  const images = metadataStore();
  return {
    store: new S3ImageStore(config, images, createS3Fake().fetch),
    record: (hash) => images.record({ hash, sizeBytes: 1, width: 1, height: 1 }, at),
  };
});

describe('s3ObjectUrl', () => {
  it('puts the bucket in the host for virtual-hosted style', () => {
    expect(s3ObjectUrl(config, 'images/a.png').toString()).toBe(
      'https://targus-images.s3.eu-west-1.amazonaws.com/images/a.png',
    );
  });

  it('puts the bucket in the path for path style, keeping the endpoint path', () => {
    expect(s3ObjectUrl(minio, 'images/a.png').toString()).toBe(
      'http://localhost:9000/targus-images/images/a.png',
    );
    const prefixed = { ...minio, endpoint: 'https://store.example/s3' };
    expect(s3ObjectUrl(prefixed, 'images/a.png').toString()).toBe(
      'https://store.example/s3/targus-images/images/a.png',
    );
  });
});

describe('S3ImageStore requests', () => {
  it('signs every request with SigV4 for the bucket region', async () => {
    const s3 = createS3Fake();
    const store = new S3ImageStore(config, metadataStore(), s3.fetch);

    await store.put(imageHash('a'), new Uint8Array([1, 2, 3]));
    await store.get(imageHash('a'));

    expect(s3.requests.map((request) => request.method)).toEqual(['HEAD', 'PUT', 'GET']);
    for (const request of s3.requests) {
      const authorization = request.headers.get('authorization') ?? '';
      expect(authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\//);
      expect(authorization).toContain('/eu-west-1/s3/aws4_request');
      expect(request.headers.get('x-amz-date')).toMatch(/^\d{8}T\d{6}Z$/);
    }
  });

  it('stores each image as an immutable PNG under images/<hash>.png', async () => {
    const s3 = createS3Fake();
    const store = new S3ImageStore(minio, metadataStore(), s3.fetch);

    await store.put(imageHash('a'), new Uint8Array([1, 2, 3]));

    const url = `http://localhost:9000/targus-images/images/${imageHash('a')}.png`;
    const headers = s3.objects.get(url)?.headers;
    expect(headers?.get('content-type')).toBe('image/png');
    expect(headers?.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(headers?.get('x-amz-content-sha256')).toBe('UNSIGNED-PAYLOAD');
  });

  it('skips the upload when the object is already there', async () => {
    const s3 = createS3Fake();
    const store = new S3ImageStore(config, metadataStore(), s3.fetch);

    await store.put(imageHash('a'), new Uint8Array([1]));
    await store.put(imageHash('a'), new Uint8Array([1]));

    expect(s3.requests.map((request) => request.method)).toEqual(['HEAD', 'PUT', 'HEAD']);
  });

  it('throws when an upload answers 404, as a bucket that does not exist does', async () => {
    const store = new S3ImageStore(config, metadataStore(), createS3Fake({ status: 404 }).fetch);

    expect(await store.get(imageHash('a'))).toBeNull();
    await expect(store.put(imageHash('a'), new Uint8Array([1]))).rejects.toThrow(/PUT.*404/);
  });

  it('throws on any failure other than 404', async () => {
    const store = new S3ImageStore(config, metadataStore(), createS3Fake({ status: 403 }).fetch);

    await expect(store.get(imageHash('a'))).rejects.toThrow(/S3 GET images\/.* status 403/);
    await expect(store.put(imageHash('a'), new Uint8Array([1]))).rejects.toThrow(/HEAD.*403/);
  });
});
