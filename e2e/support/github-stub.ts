import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

// A stand-in for github.com and api.github.com, just enough for the review flow: the OAuth
// login round trip, installation tokens, org membership and check runs. The Worker under test
// is pointed at it through GITHUB_OAUTH_ORIGIN and GITHUB_API_ORIGIN (playwright.config.ts).
// Control routes under /__ let a spec choose who signs in next and read the calls GitHub saw.

/** A check-run request the stub received, as a spec asserts on it. */
export interface RecordedCheckRun {
  readonly method: 'POST' | 'PATCH';
  readonly repo: string;
  readonly checkRunId: number | null;
  readonly body: Record<string, unknown>;
}

/** Logins the stub knows. `octocat` belongs to every org; `outsider` to none. */
const users: Record<string, { id: number; member: boolean }> = {
  octocat: { id: 583231, member: true },
  outsider: { id: 9001, member: false },
};

interface StubState {
  nextLogin: string;
  nextCheckRunId: number;
  readonly checkRuns: RecordedCheckRun[];
}

interface Reply {
  readonly status: number;
  readonly body?: unknown;
  readonly location?: string;
}

interface Call {
  readonly method: string;
  readonly url: URL;
  readonly match: RegExpExecArray;
  readonly body: Record<string, unknown>;
  readonly authorization: string | undefined;
  readonly state: StubState;
}

interface Route {
  readonly method: string;
  readonly path: RegExp;
  readonly reply: (call: Call) => Reply;
}

/** The login behind an OAuth code or access token the stub issued, if it is a known user. */
function loginOf(value: string | undefined): string | null {
  const login = value?.replace(/^(code|token)-/, '') ?? '';
  return login in users ? login : null;
}

function authorize({ url, state }: Call): Reply {
  const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
  redirect.searchParams.set('code', `code-${state.nextLogin}`);
  redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
  return { status: 302, location: redirect.href };
}

function accessToken({ body }: Call): Reply {
  const login = loginOf(typeof body.code === 'string' ? body.code : undefined);
  if (login === null) return { status: 200, body: { error: 'bad_verification_code' } };
  return { status: 200, body: { access_token: `token-${login}`, token_type: 'bearer' } };
}

function user({ authorization }: Call): Reply {
  const login = loginOf(authorization?.replace(/^Bearer /i, ''));
  const known = login === null ? undefined : users[login];
  if (login === null || known === undefined) {
    return { status: 401, body: { message: 'Bad credentials' } };
  }
  const avatar = `https://avatars.example/${login}.png`;
  return { status: 200, body: { id: known.id, login, avatar_url: avatar } };
}

function checkRun({ method, match, body, state }: Call): Reply {
  const existing = match[2];
  const id = existing === undefined ? state.nextCheckRunId++ : Number(existing);
  state.checkRuns.push({
    method: method === 'POST' ? 'POST' : 'PATCH',
    repo: match[1] ?? '',
    checkRunId: existing === undefined ? null : id,
    body,
  });
  return { status: method === 'POST' ? 201 : 200, body: { id } };
}

const routes: readonly Route[] = [
  { method: 'GET', path: /^\/login\/oauth\/authorize$/, reply: authorize },
  { method: 'POST', path: /^\/login\/oauth\/access_token$/, reply: accessToken },
  { method: 'GET', path: /^\/user$/, reply: user },
  {
    method: 'POST',
    path: /^\/app\/installations\/\d+\/access_tokens$/,
    reply: () => ({
      status: 201,
      body: { token: 'installation-token', expires_at: '2099-01-01T00:00:00Z' },
    }),
  },
  {
    method: 'GET',
    path: /^\/orgs\/[^/]+\/members\/([^/]+)$/,
    reply: ({ match }) => ({ status: users[match[1] ?? '']?.member === true ? 204 : 404 }),
  },
  { method: 'POST', path: /^\/repos\/([^/]+\/[^/]+)\/check-runs$/, reply: checkRun },
  { method: 'PATCH', path: /^\/repos\/([^/]+\/[^/]+)\/check-runs\/(\d+)$/, reply: checkRun },
  {
    method: 'POST',
    path: /^\/__next-login$/,
    reply: ({ body, state }) => {
      state.nextLogin = typeof body.login === 'string' ? body.login : 'octocat';
      return { status: 204 };
    },
  },
  {
    method: 'GET',
    path: /^\/__check-runs$/,
    reply: ({ url, state }) => {
      const repo = url.searchParams.get('repo');
      return {
        status: 200,
        body: state.checkRuns.filter((run) => repo === null || run.repo === repo),
      };
    },
  },
];

function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      resolve(text === '' ? {} : (JSON.parse(text) as Record<string, unknown>));
    });
    request.on('error', reject);
  });
}

function send(response: ServerResponse, reply: Reply): void {
  if (reply.location !== undefined) {
    response.writeHead(reply.status, { location: reply.location }).end();
  } else if (reply.body === undefined) {
    response.writeHead(reply.status).end();
  } else {
    const headers = { 'content-type': 'application/json' };
    response.writeHead(reply.status, headers).end(JSON.stringify(reply.body));
  }
}

async function dispatch(state: StubState, request: IncomingMessage, port: number): Promise<Reply> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
  for (const route of routes) {
    const match = route.method === method ? route.path.exec(url.pathname) : null;
    if (match === null) continue;
    const body = method === 'GET' ? {} : await readBody(request);
    return route.reply({
      method,
      url,
      match,
      body,
      authorization: request.headers.authorization,
      state,
    });
  }
  return { status: 404, body: { message: `stub has no ${method} ${url.pathname}` } };
}

/** Start the stub on `port`; resolves once it listens. */
export function startGitHubStub(port: number): Promise<Server> {
  const state: StubState = { nextLogin: 'octocat', nextCheckRunId: 1000, checkRuns: [] };
  const server = createServer((request, response) => {
    dispatch(state, request, port).then(
      (reply) => {
        send(response, reply);
      },
      (error: unknown) => {
        send(response, { status: 500, body: { message: String(error) } });
      },
    );
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
  });
}
