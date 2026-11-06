import { describe, expect, it } from 'vitest';

import { TargusApiClient, type Fetch } from './api-client.adapter.ts';

const hash = 'b'.repeat(64);

/** A `fetch` that gives the queued answers in order, repeating the last. */
function scripted(...answers: Response[]): Fetch {
  return () => {
    const answer = answers.length > 1 ? answers.shift() : answers[0];
    if (answer === undefined) throw new Error('no answer scripted');
    return Promise.resolve(answer.clone());
  };
}

function client(fetch: Fetch) {
  const warnings: string[] = [];
  const api = new TargusApiClient({
    baseUrl: 'https://targus.test',
    token: 'tok',
    fetch,
    sleep: () => Promise.resolve(),
    onRetry: (line) => warnings.push(line),
  });
  return { api, warnings };
}

async function messageOf(promise: Promise<unknown>): Promise<string> {
  const error: unknown = await promise.then(
    () => new Error('expected a rejection'),
    (caught: unknown) => caught,
  );
  if (!(error instanceof Error)) throw new Error('expected an Error');
  return error.message;
}

function apiError(status: number, message: string, requestId: string): Response {
  return Response.json({ error: { code: 'not_found', message, requestId } }, { status });
}

describe('TargusApiClient request ids', () => {
  it('appends the request id from an API error body', async () => {
    const { api } = client(scripted(apiError(404, 'no such image', 'req-from-the-body')));

    expect(await messageOf(api.getImage(hash))).toBe(
      `GET /api/images/${hash} failed with 404: no such image (request id: req-from-the-body)`,
    );
  });

  it('prefers the body id to the header', async () => {
    const answer = Response.json(
      { error: { code: 'forbidden', message: 'not a member', requestId: 'req-body' } },
      { status: 403, headers: { 'x-request-id': 'req-header' } },
    );
    const { api } = client(scripted(answer));

    expect(await messageOf(api.getImage(hash))).toMatch(/not a member \(request id: req-body\)$/);
  });

  it('falls back to the x-request-id header for a body without one', async () => {
    const edge = new Response('<html>bad gateway</html>', {
      status: 418,
      headers: { 'x-request-id': 'req-from-the-header' },
    });
    const { api } = client(scripted(edge));

    expect(await messageOf(api.getImage(hash))).toBe(
      `GET /api/images/${hash} failed with 418: <html>bad gateway</html> ` +
        '(request id: req-from-the-header)',
    );
  });

  it('adds nothing when neither the body nor the headers carry an id', async () => {
    const { api } = client(scripted(new Response('no such image', { status: 404 })));

    expect(await messageOf(api.getImage(hash))).toBe(
      `GET /api/images/${hash} failed with 404: no such image`,
    );
  });

  it('names each try in its warning and the last try once retries give up', async () => {
    const stub = scripted(
      apiError(503, 'busy', 'req-1'),
      apiError(503, 'busy', 'req-2'),
      apiError(503, 'busy', 'req-3'),
      apiError(503, 'busy', 'req-4'),
    );
    const { api, warnings } = client(stub);

    expect(await messageOf(api.getImage(hash))).toBe(
      `GET /api/images/${hash} failed with 503: busy (gave up after 4 attempts) (request id: req-4)`,
    );
    expect(warnings.map((line) => /request id: (req-\d)/.exec(line)?.[1])).toEqual([
      'req-1',
      'req-2',
      'req-3',
    ]);
  });
});
