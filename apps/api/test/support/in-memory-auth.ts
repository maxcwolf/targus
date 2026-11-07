import { TargusError, type ReviewerUser } from '@targus/core';

import type { GitHubOAuth, GitHubUser } from '../../src/adapters/github-oauth.adapter.ts';
import type {
  CachedMembership,
  MembershipRepository,
} from '../../src/repositories/membership.repository.ts';
import type { NewSession, SessionRepository } from '../../src/repositories/session.repository.ts';
import type { UserRepository } from '../../src/repositories/user.repository.ts';
import type { ServiceDeps } from '../../src/services/deps.ts';
import type { Reviewer } from '../../src/services/principal.ts';
import { foreignKeyViolation, uniqueViolation } from './d1-semantics.ts';

// In-memory doubles of the login side: users, sessions, the membership cache and GitHub OAuth.

export function createInMemoryUsers(): UserRepository & { readonly all: ReviewerUser[] } {
  const all: ReviewerUser[] = [];
  return {
    all,
    upsertByGithubId({ id, githubId, login, avatarUrl }) {
      const index = all.findIndex((user) => user.githubId === githubId);
      // A new GitHub id under an id another user has breaks the primary key, as in D1.
      if (index === -1 && all.some((user) => user.id === id)) return uniqueViolation('users.id');
      const user = { id: all[index]?.id ?? id, githubId, login, avatarUrl };
      if (index === -1) all.push(user);
      else all[index] = user;
      return Promise.resolve(user);
    },
    findById: (id) => Promise.resolve(all.find((user) => user.id === id) ?? null),
  };
}

/** Sessions by id hash, like the D1 table: `all` never holds a raw session id. */
export function createInMemorySessions(
  users: UserRepository,
): SessionRepository & { readonly all: Map<string, NewSession> } {
  const all = new Map<string, NewSession>();
  return {
    all,
    async create(session) {
      // The foreign key on user_id, as D1 enforces it; then the primary key, with no await
      // between the check and the write.
      if ((await users.findById(session.userId)) === null) {
        return foreignKeyViolation('sessions.user_id');
      }
      if (all.has(session.idHash)) return uniqueViolation('sessions.id_hash');
      all.set(session.idHash, session);
    },
    async findActive(idHash, now) {
      const session = all.get(idHash);
      if (session === undefined || session.expiresAt <= now) return null;
      const user = await users.findById(session.userId);
      return user === null ? null : { expiresAt: session.expiresAt, user };
    },
    delete(idHash) {
      all.delete(idHash);
      return Promise.resolve();
    },
    deleteExpired(now) {
      const expired = [...all].filter(([, session]) => session.expiresAt <= now);
      for (const [idHash] of expired) all.delete(idHash);
      return Promise.resolve(expired.length);
    },
  };
}

/** The parents a cached membership names: a user, and an org, which the projects double keeps. */
export interface MembershipParents {
  readonly users: Pick<UserRepository, 'findById'>;
  readonly orgs: { readonly orgExists: (orgId: string) => boolean };
}

export function createInMemoryMemberships(parents: MembershipParents): MembershipRepository & {
  readonly all: Map<string, CachedMembership>;
} {
  const all = new Map<string, CachedMembership>();
  const key = (userId: string, orgId: string) => `${userId}\u0000${orgId}`;
  return {
    all,
    get: (userId, orgId) => Promise.resolve(all.get(key(userId, orgId)) ?? null),
    // The foreign keys on user_id and org_id, as D1 enforces them; then the upsert.
    async set(userId, orgId, member, checkedAt) {
      if ((await parents.users.findById(userId)) === null) {
        return foreignKeyViolation('org_memberships.user_id');
      }
      if (!parents.orgs.orgExists(orgId)) return foreignKeyViolation('org_memberships.org_id');
      all.set(key(userId, orgId), { member, checkedAt });
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
  deps: Pick<ServiceDeps, 'clock' | 'sessions' | 'tokens' | 'users'>,
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
  const idHash = await deps.tokens.hash(sessionId);
  await deps.sessions.create({ idHash, userId: user.id, createdAt: now, expiresAt });
  return { sessionId, user };
}
