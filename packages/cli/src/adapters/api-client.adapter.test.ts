import { isTargusError, type CreateBuildRequest } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { TargusApiClient, type Fetch } from './api-client.adapter.ts';
import { errorCodeForStatus } from './api-errors.ts';

const sha = 'a'.repeat(40);
const hash = 'b'.repeat(64);

interface Recorded {
  readonly url: string;
  readonly init: RequestInit;
}

function stubFetch(respond: (url: string, init: RequestInit) => Response) {
  const calls: Recorded[] = [];
  const fetch: Fetch = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(respond(url, init));
  };
  return { fetch, calls };
}

function client(fetch: Fetch): TargusApiClient {
  return new TargusApiClient({
    baseUrl: 'https://targus.test',
    token: 'tok',
    fetch,
    sleep: () => Promise.resolve(),
  });
}

const buildRequest: CreateBuildRequest = {
  sha,
  branch: 'feature/x',
  prNumber: 4,
  mergeBaseSha: sha,
  ancestors: [],
  trigger: 'pr',
  device: 'iPhone 16',
  snapshots: [{ storyId: 's', variant: 'default', imageHash: hash, width: 1, height: 1 }],
};

const buildResponse = {
  build: { id: 'b1', number: 1 },
  baselineBuildId: null,
  baselines: [],
  missingImageHashes: [hash],
  threshold: 0.001,
};

const submitResponse = {
  build: { id: 'b1', number: 1 },
  summary: {
    status: 'passed',
    conclusion: 'success',
    pendingCount: 0,
    deniedCount: 0,
    errorCount: 0,
  },
  reviewUrl: 'https://targus.test/builds/b1',
  checkRun: { id: 7 },
  checkRunMissing: null,
};

async function rejection(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    if (isTargusError(error)) return { code: error.code, message: error.message };
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('TargusApiClient.createBuild', () => {
  it('POSTs JSON with the bearer token and parses the response', async () => {
    const stub = stubFetch(() => Response.json(buildResponse));

    expect(await client(stub.fetch).createBuild(buildRequest)).toEqual(buildResponse);
    const [call] = stub.calls;
    expect(call?.url).toBe('https://targus.test/api/builds');
    expect(call?.init.method).toBe('POST');
    expect(call?.init.headers).toEqual({
      authorization: 'Bearer tok',
      'content-type': 'application/json',
    });
    const body = call?.init.body;
    expect(JSON.parse(typeof body === 'string' ? body : '')).toEqual(buildRequest);
  });

  it('rejects a malformed response with the schema error', async () => {
    const stub = stubFetch(() => Response.json({ build: { id: 'b1' }, baselines: [] }));

    const error = await rejection(client(stub.fetch).createBuild(buildRequest));
    expect(error.code).toBe('internal');
    expect(error.message).toContain('unexpected body');
    expect(error.message).toContain('missingImageHashes');
  });

  it('rejects a body that is not JSON', async () => {
    const stub = stubFetch(() => new Response('<html>', { status: 200 }));

    expect((await rejection(client(stub.fetch).createBuild(buildRequest))).message).toContain(
      'invalid JSON',
    );
  });

  it('maps 401 to unauthorized with the server message', async () => {
    const stub = stubFetch(() =>
      Response.json({ error: { code: 'unauthorized', message: 'bad token' } }, { status: 401 }),
    );

    expect(await rejection(client(stub.fetch).createBuild(buildRequest))).toEqual({
      code: 'unauthorized',
      message: 'POST /api/builds failed with 401: bad token',
    });
  });

  it('wraps a network failure as internal', async () => {
    const fetch: Fetch = () => Promise.reject(new TypeError('fetch failed'));

    const error = await rejection(client(fetch).createBuild(buildRequest));
    expect(error).toEqual({
      code: 'internal',
      message: 'POST /api/builds: cannot reach https://targus.test',
    });
  });
});

describe('TargusApiClient.currentProject', () => {
  const current = {
    project: {
      id: 'p1',
      orgId: 'o1',
      githubOrg: 'example-org',
      repo: 'example-org/example-app',
      name: 'the pilot app',
      defaultBranch: 'main',
    },
  };

  it('GETs the project of the token and parses it', async () => {
    const stub = stubFetch(() => Response.json(current));

    expect(await client(stub.fetch).currentProject()).toEqual(current);
    expect(stub.calls[0]?.url).toBe('https://targus.test/api/projects/current');
    expect(stub.calls[0]?.init).toMatchObject({
      method: 'GET',
      headers: { authorization: 'Bearer tok' },
    });
  });
});

describe('TargusApiClient images', () => {
  it('PUTs a PNG with content type image/png', async () => {
    const png = new Uint8Array([1, 2, 3]);
    const stub = stubFetch(() => Response.json({ hash, stored: true }));

    expect(await client(stub.fetch).uploadImage(hash, png)).toEqual({ hash, stored: true });
    const [call] = stub.calls;
    expect(call?.url).toBe(`https://targus.test/api/images/${hash}`);
    expect(call?.init.method).toBe('PUT');
    expect(call?.init.headers).toEqual({
      authorization: 'Bearer tok',
      'content-type': 'image/png',
    });
    expect(call?.init.body).toEqual(png);
  });

  it('GETs an image as bytes with the bearer token', async () => {
    const stub = stubFetch(() => new Response(new Uint8Array([9, 8])));

    expect(await client(stub.fetch).getImage(hash)).toEqual(new Uint8Array([9, 8]));
    expect(stub.calls[0]?.init).toEqual({
      method: 'GET',
      headers: { authorization: 'Bearer tok' },
      signal: expect.any(AbortSignal) as unknown,
    });
  });

  it('maps a missing image to not_found using a plain-text body', async () => {
    const stub = stubFetch(() => new Response('no such image', { status: 404 }));

    expect(await rejection(client(stub.fetch).getImage(hash))).toEqual({
      code: 'not_found',
      message: `GET /api/images/${hash} failed with 404: no such image`,
    });
  });
});

describe('TargusApiClient.submitResults', () => {
  it('POSTs to the build results route and parses the summary', async () => {
    const stub = stubFetch(() => Response.json(submitResponse));

    const response = await client(stub.fetch).submitResults('b 1', {
      results: [],
      durationMs: 5,
      threshold: 0.001,
    });
    expect(response.checkRun).toEqual({ id: 7 });
    expect(stub.calls[0]?.url).toBe('https://targus.test/api/builds/b%201/results');
  });

  it('uses a string error or message field from the body', async () => {
    const asString = stubFetch(() => Response.json({ error: 'nope' }, { status: 403 }));
    const asMessage = stubFetch(() => Response.json({ message: 'clash' }, { status: 409 }));
    const empty = stubFetch(() => new Response('', { status: 500, statusText: 'Server Error' }));
    const lastTry = /500: Server Error \(gave up after 4 attempts\)$/;
    const request = { results: [], durationMs: 0, threshold: 0.001 };

    expect((await rejection(client(asString.fetch).submitResults('b', request))).code).toBe(
      'forbidden',
    );
    expect((await rejection(client(asMessage.fetch).submitResults('b', request))).message).toMatch(
      /409: clash$/,
    );
    expect((await rejection(client(empty.fetch).submitResults('b', request))).message).toMatch(
      lastTry,
    );
  });
});

describe('errorCodeForStatus', () => {
  it.each([
    [400, 'bad_request'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'bad_request'],
    [501, 'not_implemented'],
    [502, 'internal'],
  ])('%i -> %s', (status, code) => {
    expect(errorCodeForStatus(status)).toBe(code);
  });
});
