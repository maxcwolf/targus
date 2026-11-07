import { CreateBuildRequest, isTargusError } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { TargusApiClient, type Fetch, type TargusApiClientOptions } from './api-client.adapter.ts';

const hash = 'b'.repeat(64);
const png = new Uint8Array([1, 2, 3]);
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
  checkRun: null,
  checkRunMissing: 'no_installation',
};
const buildRequest: CreateBuildRequest = {
  sha: 'a'.repeat(40),
  branch: 'main',
  prNumber: null,
  mergeBaseSha: null,
  ancestors: [],
  trigger: 'main',
  device: 'iPhone 16',
  snapshots: [],
};

type Answer = Response | Error;

/** A `fetch` that gives the queued answers in order, repeating the last; it records each call. */
function scripted(...answers: Answer[]) {
  const urls: string[] = [];
  const fetch: Fetch = (url) => {
    urls.push(url);
    const answer = answers.length > 1 ? answers.shift() : answers[0];
    if (answer === undefined) throw new Error('no answer scripted');
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer.clone());
  };
  return { fetch, urls };
}

function client(fetch: Fetch, options: Partial<TargusApiClientOptions> = {}) {
  const waits: number[] = [];
  const warnings: string[] = [];
  const api = new TargusApiClient({
    baseUrl: 'https://targus.test',
    token: 'tok',
    fetch,
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    onRetry: (line) => warnings.push(line),
    ...options,
  });
  return { api, waits, warnings };
}

async function failure(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    if (isTargusError(error)) return { code: error.code, message: error.message };
    throw error;
  }
  throw new Error('expected a rejection');
}

const unavailable = () => new Response('busy', { status: 503 });
const stored = () => Response.json({ hash, stored: true });

describe('TargusApiClient retries', () => {
  it('retries an upload on 5xx, 429 and network errors with exponential backoff', async () => {
    const network = new TypeError('fetch failed');
    const stub = scripted(
      unavailable(),
      new Response('slow down', { status: 429 }),
      network,
      stored(),
    );
    const { api, waits, warnings } = client(stub.fetch);

    expect(await api.uploadImage(hash, png)).toEqual({ hash, stored: true });
    expect(stub.urls).toHaveLength(4);
    expect(waits).toEqual([500, 1000, 2000]);
    expect(warnings).toEqual([
      `warning: PUT /api/images/${hash} failed with 503: busy; retrying in 500ms (attempt 2 of 4)`,
      `warning: PUT /api/images/${hash} failed with 429: slow down; retrying in 1s (attempt 3 of 4)`,
      `warning: PUT /api/images/${hash}: cannot reach https://targus.test; retrying in 2s (attempt 4 of 4)`,
    ]);
  });

  it('gives up after the last attempt and says how many it made', async () => {
    const stub = scripted(unavailable());
    const { api, waits } = client(stub.fetch);

    expect(await failure(api.uploadImage(hash, png))).toEqual({
      code: 'internal',
      message: `PUT /api/images/${hash} failed with 503: busy (gave up after 4 attempts)`,
    });
    expect(waits).toHaveLength(3);
  });

  it('keeps the network cause so the error can be explained', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const stub = scripted(new TypeError('fetch failed', { cause: refused }));
    const { api } = client(stub.fetch, { retry: { attempts: 2, initialDelayMs: 10 } });

    const error: unknown = await api.getImage(hash).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    const chain: unknown[] = [];
    for (let link: unknown = error; link instanceof Error; link = link.cause) chain.push(link);
    expect(chain).toContain(refused);
  });
});

describe('TargusApiClient retries by request', () => {
  it.each([400, 401, 403, 404, 409, 422, 501])('does not retry a %i', async (status) => {
    const stub = scripted(new Response('no', { status }));
    const { api, waits } = client(stub.fetch);

    await failure(api.uploadImage(hash, png));

    expect(stub.urls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it('does not retry opening a build without an idempotency key', async () => {
    const stub = scripted(unavailable());
    const { api } = client(stub.fetch);

    expect((await failure(api.createBuild(buildRequest))).message).toBe(
      'POST /api/builds failed with 503: busy',
    );
    expect(stub.urls).toHaveLength(1);
  });

  it('retries submitting results and flags a 409 that follows a lost response', async () => {
    const conflict = Response.json(
      { error: { message: 'build b1 already has results' } },
      { status: 409 },
    );
    const stub = scripted(new Response('', { status: 502 }), conflict);
    const { api } = client(stub.fetch);

    expect(
      await failure(api.submitResults('b1', { results: [], durationMs: 1, threshold: 0.001 })),
    ).toEqual({
      code: 'conflict',
      message:
        'POST /api/builds/b1/results failed with 409: build b1 already has results; the build ' +
        'already has different results, from another submission',
    });
  });

  it('submits once when the first attempt succeeds', async () => {
    const stub = scripted(Response.json(submitResponse));
    const { api, waits } = client(stub.fetch);

    expect(
      (await api.submitResults('b1', { results: [], durationMs: 1, threshold: 0.001 })).build.id,
    ).toBe('b1');
    expect(waits).toEqual([]);
  });
});

describe('TargusApiClient resubmitting results', () => {
  it('ends normally when a retry after a lost response is answered as a replay', async () => {
    const bodies: unknown[] = [];
    // Stores the first submission but loses its response; the server answers the same body
    // again with the stored outcome (ADR 0031).
    const fetch: Fetch = (_url, init) => {
      bodies.push(init.body);
      if (bodies.length === 1) return Promise.reject(new TypeError('fetch failed'));
      return Promise.resolve(Response.json(submitResponse));
    };
    const { api, warnings } = client(fetch);
    const results = { results: [], durationMs: 1, threshold: 0.001 };

    expect(await api.submitResults('b1', results)).toEqual(submitResponse);
    expect(bodies).toEqual([JSON.stringify(results), JSON.stringify(results)]);
    expect(warnings).toEqual([
      'warning: POST /api/builds/b1/results: cannot reach https://targus.test; retrying in ' +
        '500ms (attempt 2 of 4)',
    ]);
  });
});

describe('TargusApiClient opening a build under an idempotency key', () => {
  it('reports a 409 on a retry without the hint about results', async () => {
    const conflict = Response.json({ error: { message: 'key used by b1' } }, { status: 409 });
    const stub = scripted(new Response('', { status: 502 }), conflict);
    const { api } = client(stub.fetch);

    expect(
      (await failure(api.createBuild({ ...buildRequest, idempotencyKey: 'run-1' }))).message,
    ).toBe('POST /api/builds failed with 409: key used by b1');
  });

  it('retries after a timeout with the same key, and the server opens one build', async () => {
    const opened = new Map<string, string>();
    const keys: (string | undefined)[] = [];
    const controllers: AbortController[] = [];
    // Opens one build per key, as the API does, but loses the first response.
    const fetch: Fetch = (_url, init) => {
      const { idempotencyKey } = CreateBuildRequest.parse(
        JSON.parse(typeof init.body === 'string' ? init.body : '{}'),
      );
      keys.push(idempotencyKey);
      const id = opened.get(String(idempotencyKey)) ?? `b${opened.size + 1}`;
      opened.set(String(idempotencyKey), id);
      if (keys.length === 1) {
        const timeout = new DOMException('timed out', 'TimeoutError');
        controllers.at(-1)?.abort(timeout);
        return Promise.reject(timeout);
      }
      const build = { build: { id, number: 1 }, baselineBuildId: null, baselines: [] };
      return Promise.resolve(Response.json({ ...build, missingImageHashes: [], threshold: 0.001 }));
    };
    const timeoutSignal = () => {
      const controller = new AbortController();
      controllers.push(controller);
      return controller.signal;
    };
    const { api, waits, warnings } = client(fetch, { timeoutSignal, timeoutMs: 30_000 });

    const response = await api.createBuild({ ...buildRequest, idempotencyKey: 'run-1' });

    expect(response.build.id).toBe('b1');
    expect([...opened.values()]).toEqual(['b1']);
    expect(keys).toEqual(['run-1', 'run-1']);
    expect(waits).toEqual([500]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /^warning: POST \/api\/builds: no response .* within 30s; retrying/,
    );
  });
});

/** A `fetch` that never answers on its own and rejects once its signal aborts, as fetch does. */
const hangingFetch: Fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {
      reject(new DOMException('This operation was aborted', 'TimeoutError'));
    });
  });

describe('TargusApiClient timeouts', () => {
  it('aborts each attempt after the timeout and names the request', async () => {
    const timeouts: number[] = [];
    const timeoutSignal = (ms: number) => {
      timeouts.push(ms);
      const controller = new AbortController();
      // Expire at once: the test stands in for the timer.
      queueMicrotask(() => {
        controller.abort(new DOMException('timed out', 'TimeoutError'));
      });
      return controller.signal;
    };
    const { api } = client(hangingFetch, { timeoutSignal, timeoutMs: 45_000 });

    expect(await failure(api.getImage(hash))).toEqual({
      code: 'internal',
      message: `GET /api/images/${hash}: no response from https://targus.test within 45s (gave up after 4 attempts)`,
    });
    expect(timeouts).toEqual([45_000, 45_000, 45_000, 45_000]);
  });

  it('covers reading the body too', async () => {
    const controller = new AbortController();
    const stalledBody: Fetch = () =>
      Promise.resolve({
        ok: true,
        text: () => {
          const timedOut = new DOMException('timed out', 'TimeoutError');
          controller.abort(timedOut);
          return Promise.reject(timedOut);
        },
      } as unknown as Response);
    const { api } = client(stalledBody, {
      timeoutSignal: () => controller.signal,
      timeoutMs: 1000,
    });

    expect((await failure(api.createBuild(buildRequest))).message).toBe(
      'POST /api/builds: no response from https://targus.test within 1s',
    );
  });

  it('uses a real timeout signal by default', async () => {
    const { api } = client(hangingFetch, {
      timeoutMs: 20,
      retry: { attempts: 1, initialDelayMs: 0 },
    });

    expect((await failure(api.getImage(hash))).message).toBe(
      `GET /api/images/${hash}: no response from https://targus.test within 20ms`,
    );
  });
});
