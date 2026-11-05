import { fakeClockEpoch, type ReviewerUser } from '@targus/core';
import { env } from 'cloudflare:workers';
import { generateSignedCookie } from 'hono/cookie';

import { createSessionRepository } from '../../src/repositories/session.repository.js';
import { createUserRepository } from '../../src/repositories/user.repository.js';
import { sessionSecret } from './api.js';

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
 * Create a user and a session in the local D1 and sign the cookie the way `sessionAuth` checks
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
    id: sessionId,
    userId: user.id,
    createdAt: new Date(fakeClockEpoch),
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  });
  const setCookie = await generateSignedCookie('targus_session', sessionId, sessionSecret);
  return { cookie: setCookie.split(';')[0] ?? '', user, sessionId };
}

/** Request headers carrying a session cookie. */
export function withCookie(cookie: string): { cookie: string } {
  return { cookie };
}
