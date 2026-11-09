import type { ImageStore } from '@targus/core';
import { AwsClient } from 'aws4fetch';

import type { S3Config } from '../config.ts';
import type { ImageRepository } from '../repositories/image.repository.ts';

/** Sends a signed request. Injected so tests never reach the network. */
export type S3Fetch = (request: Request) => Promise<Response>;

/** Object key of an image, the same layout as the R2 store, so a bucket can be copied as is. */
function keyFor(hash: string): string {
  return `images/${hash}.png`;
}

/** The URL of `key`: `endpoint/bucket/key` (path style) or `bucket.endpoint/key`. */
export function s3ObjectUrl(config: S3Config, key: string): URL {
  const url = new URL(config.endpoint);
  const base = url.pathname.replace(/\/+$/, '');
  if (config.forcePathStyle) {
    url.pathname = `${base}/${config.bucket}/${key}`;
  } else {
    url.hostname = `${config.bucket}.${url.hostname}`;
    url.pathname = `${base}/${key}`;
  }
  return url;
}

/**
 * `ImageStore` over any S3-compatible bucket (AWS S3, MinIO, R2's S3 API), with requests signed
 * by aws4fetch (SigV4). Like `R2ImageStore`, `missing()` asks the `images` table, not the bucket;
 * callers record the metadata row (`ImageRepository.record`) after `put`.
 */
export class S3ImageStore implements ImageStore {
  private readonly signer: AwsClient;

  constructor(
    private readonly config: S3Config,
    private readonly metadata: Pick<ImageRepository, 'missing'>,
    private readonly send: S3Fetch,
  ) {
    this.signer = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region,
      service: 's3',
    });
  }

  missing(hashes: readonly string[]): Promise<string[]> {
    return this.metadata.missing(hashes);
  }

  async put(hash: string, bytes: Uint8Array): Promise<void> {
    const key = keyFor(hash);
    if ((await this.request('HEAD', key)) !== null) return;
    await this.request('PUT', key, {
      body: bytes.slice(),
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  }

  async get(hash: string): Promise<Uint8Array | null> {
    const response = await this.request('GET', keyFor(hash));
    if (response === null) return null;
    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * A signed request for `key`: the response on 2xx, null when a read (GET, HEAD) finds nothing,
   * and a throw otherwise. A 404 on a PUT is thrown: it means the bucket is not there, and
   * answering null would report an upload that stored nothing.
   */
  private async request(
    method: 'GET' | 'HEAD' | 'PUT',
    key: string,
    init: { body?: Uint8Array; headers?: Record<string, string> } = {},
  ): Promise<Response | null> {
    const signed = await this.signer.sign(s3ObjectUrl(this.config, key).toString(), {
      method,
      ...init,
    });
    const response = await this.send(signed);
    if (response.status === 404 && method !== 'PUT') {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`S3 ${method} ${key} failed with status ${String(response.status)}`);
    }
    return response;
  }
}
