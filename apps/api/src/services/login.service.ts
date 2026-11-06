import { TargusError, type ReviewerUser } from '@targus/core';

import type { GitHubOAuth } from '../adapters/github-oauth.adapter.js';
import type { ServiceDeps } from './deps.js';

/** How long a review session (and its cookie) lasts. */
export const sessionLifetimeSeconds = 30 * 24 * 60 * 60;

/** How cookies are signed and whether they need HTTPS; null when there is no session secret. */
export interface CookieSettings {
  readonly secret: string;
  readonly secure: boolean;
}

export function cookieSettings(deps: Pick<ServiceDeps, 'config'>): CookieSettings | null {
  const secret = deps.config.sessionSecret;
  if (secret === null) return null;
  return { secret, secure: deps.config.publicUrl.startsWith('https:') };
}

/** A stand-in origin to resolve `returnTo` against; `.invalid` never resolves (RFC 2606). */
const returnToBase = 'https://targus.invalid';

/**
 * Where to go after login: only a same-origin path, anything else falls back to `/`. The value
 * is resolved the way a browser resolves a `Location` header, and what comes back is the parsed
 * path, not the input. A pattern over the raw string is not enough: `//host` and `/\\host` leave
 * the origin, and so does `/<tab>/host`, because URL parsers drop tabs and newlines first.
 * `/.//host` stays on the origin but parses to the path `//host`, which must not be sent back.
 */
export function safeReturnTo(returnTo: string | undefined): string {
  if (!returnTo?.startsWith('/')) return '/';
  let url: URL;
  try {
    url = new URL(returnTo, returnToBase);
  } catch {
    return '/';
  }
  if (url.origin !== returnToBase || url.pathname.startsWith('//')) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}

function redirectUri(deps: Pick<ServiceDeps, 'config'>): string {
  return `${deps.config.publicUrl}/api/auth/github/callback`;
}

function requireOAuth(deps: Pick<ServiceDeps, 'config' | 'oauth'>): GitHubOAuth {
  if (deps.oauth === null || deps.config.sessionSecret === null) {
    throw new TargusError('not_implemented', 'GitHub login is not configured');
  }
  return deps.oauth;
}

/** Where `GET /api/auth/github` sends the browser, and the state its cookie must carry. */
export interface LoginRedirect {
  readonly url: string;
  readonly state: string;
  readonly returnTo: string;
}

/** `GET /api/auth/github`: start the OAuth flow with a fresh `state`. */
export function beginLogin(
  deps: Pick<ServiceDeps, 'config' | 'oauth' | 'tokens'>,
  returnTo: string | undefined,
): LoginRedirect {
  const oauth = requireOAuth(deps);
  const state = deps.tokens.generate();
  return {
    url: oauth.authorizeUrl({ state, redirectUri: redirectUri(deps) }),
    state,
    returnTo: safeReturnTo(returnTo),
  };
}

/** The callback's query and the state the signed OAuth cookie remembered. */
export interface LoginCallback {
  readonly code: string | undefined;
  readonly state: string | undefined;
  readonly expectedState: string | null;
}

export interface NewLogin {
  readonly sessionId: string;
  readonly expiresAt: Date;
  readonly user: ReviewerUser;
}

type CompleteLoginDeps = Pick<
  ServiceDeps,
  'clock' | 'config' | 'ids' | 'oauth' | 'sessions' | 'tokens' | 'users'
>;

/**
 * `GET /api/auth/github/callback`: check the state, exchange the code, store the user and open
 * a 30-day session. Org membership is checked per project on access, not here.
 */
export async function completeLogin(
  deps: CompleteLoginDeps,
  callback: LoginCallback,
): Promise<NewLogin> {
  const oauth = requireOAuth(deps);
  const { code, state, expectedState } = callback;
  if (code === undefined || state === undefined || expectedState === null) {
    throw new TargusError('unauthorized', 'the login callback is missing its code or state');
  }
  if (!(await deps.tokens.equals(state, expectedState))) {
    throw new TargusError('unauthorized', 'the login state does not match; try again');
  }
  const accessToken = await oauth.exchangeCode({ code, redirectUri: redirectUri(deps) });
  const githubUser = await oauth.fetchUser(accessToken);
  const now = deps.clock.now();
  const user = await deps.users.upsertByGithubId({ id: deps.ids.next(), ...githubUser, now });
  const sessionId = deps.tokens.generate();
  const expiresAt = new Date(now.getTime() + sessionLifetimeSeconds * 1000);
  await deps.sessions.create({ id: sessionId, userId: user.id, createdAt: now, expiresAt });
  return { sessionId, expiresAt, user };
}

/** `POST /api/auth/logout`. */
export async function logout(
  deps: Pick<ServiceDeps, 'sessions'>,
  sessionId: string,
): Promise<void> {
  await deps.sessions.delete(sessionId);
}
