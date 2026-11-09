import { isMemberOf, type OrgMembers } from './org-members.ts';

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

/** The account id the stubs give installation `installationId` when a test names none. */
export function defaultAccountId(installationId: number): number {
  return 7_000_000 + installationId;
}

/** Who belongs to which org, and which account each installation is on. */
interface StubWorld {
  readonly members: OrgMembers;
  readonly accounts: Readonly<Record<number, number>>;
}

/** `GET /app/installations/:id`, or null for any other path. */
function installationReply(path: string, accounts: StubWorld['accounts']): Response | null {
  const [, installation] = /^\/app\/installations\/(\d+)$/.exec(path) ?? [];
  if (installation === undefined) return null;
  const id = Number(installation);
  return json({ id, account: { id: accounts[id] ?? defaultAccountId(id) } }, 200);
}

/** What api.github.com would answer for `path`. */
function replyTo(path: string, { members, accounts }: StubWorld): Response {
  if (path.endsWith('/access_tokens')) {
    return json({ token: 'installation-token', expires_at: '2099-01-01T00:00:00Z' }, 201);
  }
  const installation = installationReply(path, accounts);
  if (installation !== null) return installation;
  if (path.includes('/statuses/')) return json({ id: 901 }, 201);
  const [, org, login] = /\/orgs\/([^/]+)\/members\/([^/]+)$/.exec(path) ?? [];
  if (org !== undefined && login !== undefined) {
    return isMemberOf(members, decodeURIComponent(org), decodeURIComponent(login))
      ? new Response(null, { status: 204 })
      : json({ message: 'Not Found' }, 404);
  }
  return json({ message: 'Server Error' }, 500);
}

/**
 * A `fetch` that plays api.github.com for the calls `OctokitGitHubClient` makes: it mints an
 * installation token, creates check run 901, accepts updates, answers
 * `GET /orgs/:org/members/:login` from `members` (by default only `member`, in every org; see
 * `OrgMembers`) and `GET /app/installations/:id` with the account in `accounts`, by
 * installation id (`defaultAccountId` otherwise). Every request is recorded.
 */
export function createGitHubStub(
  members: OrgMembers = ['member'],
  accounts: Readonly<Record<number, number>> = {},
): GitHubStub {
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
    return replyTo(path, { members, accounts });
  };
  return { fetch: stubFetch, requests };
}
