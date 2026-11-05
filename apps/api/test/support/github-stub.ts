/** One request the stubbed GitHub API received. */
export interface RecordedGitHubRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | null;
  readonly body: unknown;
}

export interface GitHubStub {
  readonly fetch: typeof fetch;
  readonly requests: RecordedGitHubRequest[];
}

/** A throwaway RSA key as PKCS#8 PEM, the format the App's private key must be in. */
export async function generatePrivateKeyPem(): Promise<string> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  if (!(pkcs8 instanceof ArrayBuffer)) throw new Error('expected pkcs8 bytes');
  const base64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
  const lines = base64.match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A `fetch` that plays api.github.com for the calls `OctokitGitHubClient` makes: it mints an
 * installation token, creates check run 901, accepts updates, and treats `member` as the only
 * org member. Every request is recorded.
 */
export function createGitHubStub(): GitHubStub {
  const requests: RecordedGitHubRequest[] = [];
  const stubFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    const text = await request.text();
    requests.push({
      method: request.method,
      path,
      authorization: request.headers.get('authorization'),
      body: text === '' ? null : JSON.parse(text),
    });
    if (path.endsWith('/access_tokens')) {
      return json({ token: 'installation-token', expires_at: '2099-01-01T00:00:00Z' }, 201);
    }
    if (path.endsWith('/check-runs')) return json({ id: 901 }, 201);
    if (path.includes('/check-runs/')) return json({ id: 901 }, 200);
    if (path.endsWith('/members/member')) return new Response(null, { status: 204 });
    if (path.includes('/members/')) return json({ message: 'Not Found' }, 404);
    return json({ message: 'Server Error' }, 500);
  };
  return { fetch: stubFetch, requests };
}
