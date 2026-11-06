import { fakeClockEpoch, type ReviewerUser } from '@targus/core';
import { env } from 'cloudflare:workers';
import { generateSignedCookie } from 'hono/cookie';

import { sha256Hex } from '../../src/lib/sha256.ts';
import { createSessionRepository } from '../../src/repositories/session.repository.ts';
import { createUserRepository } from '../../src/repositories/user.repository.ts';
import { sessionSecret } from './api.ts';

/** A session cookie for a fresh user, and that user. */
export interface SignedIn {
  /** The `Cookie` request header value. */
  readonly cookie: string;
  readonly user: ReviewerUser;
  readonly sessionId: string;
}

function randomInt(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

/**
 * Create a user and a session (stored by the SHA-256 of its id) in the local D1 and sign the cookie the way `sessionAuth` checks
 * it. Each call is a new GitHub user (random id) unless `githubId` is given, so the membership
 * cache never carries over between tests.
 */
export async function signIn(
  login: string,
  options: { readonly githubId?: number } = {},
): Promise<SignedIn> {
  const githubId = options.githubId ?? randomInt() + 1;
  const user = await createUserRepository(env.DB).upsertByGithubId({
    id: `user-${login}-${githubId}`,
    githubId,
    login,
    avatarUrl: `https://avatars.githubusercontent.com/u/${githubId}`,
    now: new Date(fakeClockEpoch),
  });
  const sessionId = `session-${login}-${randomInt()}`;
  await createSessionRepository(env.DB).create({
    idHash: await sha256Hex(sessionId),
    userId: user.id,
    createdAt: new Date(fakeClockEpoch),
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  });
  const setCookie = await generateSignedCookie('targus_session', sessionId, sessionSecret);
  return { cookie: setCookie.split(';')[0] ?? '', user, sessionId };
}

/** The review UI's origin in the tests (`PUBLIC_URL` from wrangler.jsonc). */
export const reviewOrigin = new URL(env.PUBLIC_URL).origin;

/**
 * Request headers carrying a session cookie, sent from the review UI's origin as a browser
 * would, so cookie-authenticated writes pass the same-origin check (ADR 0015).
 */
export function withCookie(cookie: string): { cookie: string; origin: string } {
  return { cookie, origin: reviewOrigin };
}
