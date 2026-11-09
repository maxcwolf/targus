import type { S3Fetch } from '../../src/storage/s3-image-store.ts';

interface StoredObject {
  readonly bytes: Uint8Array;
  readonly headers: Headers;
}

/** A request the fake received, kept so tests can check the URL and the headers sent. */
export interface S3FakeRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
}

/** An in-memory S3 behind an injected fetch: GET, HEAD and PUT on objects keyed by URL. */
export interface S3Fake {
  readonly fetch: S3Fetch;
  readonly requests: readonly S3FakeRequest[];
  readonly objects: ReadonlyMap<string, StoredObject>;
}

async function handle(objects: Map<string, StoredObject>, request: Request): Promise<Response> {
  const stored = objects.get(request.url);
  if (request.method === 'PUT') {
    const bytes = new Uint8Array(await request.arrayBuffer());
    objects.set(request.url, { bytes, headers: new Headers(request.headers) });
    return new Response(null, { status: 200 });
  }
  if (stored === undefined) {
    const body = request.method === 'GET' ? '<Error><Code>NoSuchKey</Code></Error>' : null;
    return new Response(body, { status: 404 });
  }
  if (request.method === 'HEAD') return new Response(null, { status: 200 });
  return new Response(stored.bytes.slice(), { status: 200 });
}

/** A fake S3; `status` forces every answer to that status (for error paths). */
export function createS3Fake(options: { readonly status?: number } = {}): S3Fake {
  const objects = new Map<string, StoredObject>();
  const requests: S3FakeRequest[] = [];
  const fetch: S3Fetch = async (request) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers });
    if (options.status !== undefined) {
      return new Response('<Error><Code>AccessDenied</Code></Error>', { status: options.status });
    }
    return handle(objects, request);
  };
  return { fetch, requests, objects };
}
