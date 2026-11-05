import { TargusError, type ReviewerUser } from '@targus/core';

import type { GitHubOAuth, GitHubUser } from '../../src/adapters/github-oauth.adapter.js';
import type {
  CachedMembership,
  MembershipRepository,
} from '../../src/repositories/membership.repository.js';
import type { NewSession, SessionRepository } from '../../src/repositories/session.repository.js';
import type { UserRepository } from '../../src/repositories/user.repository.js';
import type { ServiceDeps } from '../../src/services/deps.js';
import type { Reviewer } from '../../src/services/principal.js';

// In-memory doubles of the login side: users, sessions, the membership cache and GitHub OAuth.

export function createInMemoryUsers(): UserRepository & { readonly all: ReviewerUser[] } {
  const all: ReviewerUser[] = [];
  return {
    all,
    upsertByGithubId({ id, githubId, login, avatarUrl }) {
      const index = all.findIndex((user) => user.githubId === githubId);
      const user = { id: all[index]?.id ?? id, githubId, login, avatarUrl };
      if (index === -1) all.push(user);
      else all[index] = user;
      return Promise.resolve(user);
    },
    findById: (id) => Promise.resolve(all.find((user) => user.id === id) ?? null),
  };
}

export function createInMemorySessions(
  users: UserRepository,
): SessionRepository & { readonly all: Map<string, NewSession> } {
  const all = new Map<string, NewSession>();
  return {
    all,
    create(session) {
      all.set(session.id, session);
      return Promise.resolve();
    },
    async findActive(id, now) {
      const session = all.get(id);
      if (session === undefined || session.expiresAt <= now) return null;
      const user = await users.findById(session.userId);
      return user === null ? null : { sessionId: id, expiresAt: session.expiresAt, user };
    },
    delete(id) {
      all.delete(id);
      return Promise.resolve();
    },
  };
}

export function createInMemoryMemberships(): MembershipRepository & {
  readonly all: Map<string, CachedMembership>;
} {
  const all = new Map<string, CachedMembership>();
  const key = (userId: string, orgId: string) => `${userId}\u0000${orgId}`;
  return {
    all,
    get: (userId, orgId) => Promise.resolve(all.get(key(userId, orgId)) ?? null),
    set(userId, orgId, member, checkedAt) {
      all.set(key(userId, orgId), { member, checkedAt });
      return Promise.resolve();
    },
  };
}

export const octocat: GitHubUser = {
  githubId: 583231,
  login: 'octocat',
  avatarUrl: 'https://avatars.githubusercontent.com/u/583231',
};

/** A `GitHubOAuth` whose codes are keys of `users`; any other code is refused. */
export interface FakeOAuth extends GitHubOAuth {
  readonly users: Map<string, GitHubUser>;
}

export function createFakeOAuth(
  users: Record<string, GitHubUser> = { 'octocat-code': octocat },
): FakeOAuth {
  const byCode = new Map(Object.entries(users));
  return {
    users: byCode,
    authorizeUrl({ state, redirectUri }) {
      const query = new URLSearchParams({ client_id: 'fake', redirect_uri: redirectUri, state });
      return `https://github.test/login/oauth/authorize?${query.toString()}`;
    },
    exchangeCode({ code }) {
      if (!byCode.has(code)) throw new TargusError('unauthorized', 'bad code');
      return Promise.resolve(`token-${code}`);
    },
    fetchUser(accessToken) {
      const user = byCode.get(accessToken.replace(/^token-/, ''));
      if (user === undefined) throw new TargusError('unauthorized', 'bad token');
      return Promise.resolve(user);
    },
  };
}

let reviewerCounter = 0;

/** A user and an open session through the given repositories, for service tests. */
export async function signInReviewer(
  deps: Pick<ServiceDeps, 'clock' | 'sessions' | 'users'>,
  login: string,
  githubId = 1000 + login.length,
): Promise<Reviewer> {
  reviewerCounter += 1;
  const now = deps.clock.now();
  const user = await deps.users.upsertByGithubId({
    id: `user-${login}-${reviewerCounter}`,
    githubId,
    login,
    avatarUrl: `https://avatars.githubusercontent.com/${login}`,
    now,
  });
  const sessionId = `session-${login}-${reviewerCounter}`;
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  await deps.sessions.create({ id: sessionId, userId: user.id, createdAt: now, expiresAt });
  return { sessionId, user };
}
