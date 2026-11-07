import type { ReviewerUser } from '@targus/core';
import { describe, expect, it } from 'vitest';

import type { SessionRepository } from '../../../src/repositories/session.repository.ts';
import type { UserRepository } from '../../../src/repositories/user.repository.ts';
import { isForeignKeyViolation } from '../d1-semantics.ts';

/** A sessions repository, D1's or the double's, over the users repository it joins. */
export interface SessionHarness {
  readonly repository: SessionRepository;
  readonly users: UserRepository;
}

type Harness = () => SessionHarness;

const at = new Date('2026-01-01T00:00:00.000Z');
const later = (ms: number) => new Date(at.getTime() + ms);

function signUp(users: UserRepository, id: string, githubId: number): Promise<ReviewerUser> {
  const avatarUrl = `https://avatars.test/${githubId}`;
  return users.upsertByGithubId({ id, githubId, login: id, avatarUrl, now: at });
}

async function findsUntilExpiry({ repository, users }: SessionHarness): Promise<void> {
  const user = await signUp(users, 'sc-user-1', 9201);
  await repository.create({
    idHash: 'sc-1',
    userId: user.id,
    createdAt: at,
    expiresAt: later(1000),
  });

  expect(await repository.findActive('sc-1', later(999))).toEqual({
    expiresAt: later(1000),
    user,
  });
  // Expired at the instant it expires, not a millisecond later.
  expect(await repository.findActive('sc-1', later(1000))).toBeNull();
  expect(await repository.findActive('sc-none', at)).toBeNull();

  await repository.delete('sc-1');
  await repository.delete('sc-none');
  expect(await repository.findActive('sc-1', at)).toBeNull();
}

async function rejectsTakenHash({ repository, users }: SessionHarness): Promise<void> {
  const first = await signUp(users, 'sc-user-2', 9202);
  const second = await signUp(users, 'sc-user-3', 9203);
  await repository.create({ idHash: 'sc-2', userId: first.id, createdAt: at, expiresAt: later(5) });

  await expect(
    repository.create({ idHash: 'sc-2', userId: second.id, createdAt: at, expiresAt: later(9) }),
  ).rejects.toThrow();

  expect(await repository.findActive('sc-2', at)).toEqual({ expiresAt: later(5), user: first });
}

async function rejectsUnknownUser({ repository, users }: SessionHarness): Promise<void> {
  const session = { idHash: 'sc-orphan', userId: 'sc-nobody', createdAt: at, expiresAt: later(5) };

  await expect(repository.create(session)).rejects.toSatisfy(isForeignKeyViolation);

  // Nothing was stored under the id hash: it is free for a real user's session.
  const user = await signUp(users, 'sc-user-5', 9205);
  await repository.create({ ...session, userId: user.id });
  expect(await repository.findActive('sc-orphan', at)).toEqual({ expiresAt: later(5), user });
}

async function deletesExpired({ repository, users }: SessionHarness): Promise<void> {
  const user = await signUp(users, 'sc-user-4', 9204);
  // Far in the past, so no session another test stored in the same D1 expires by it.
  const past = new Date('2000-01-01T00:00:00.000Z');
  const around = (ms: number) => new Date(past.getTime() + ms);
  for (const [idHash, expiresAt] of [
    ['sc-old', around(-1)],
    ['sc-edge', past],
    ['sc-live', around(1)],
  ] as const) {
    await repository.create({ idHash, userId: user.id, createdAt: around(-10), expiresAt });
  }

  expect(await repository.deleteExpired(past)).toBe(2);
  expect(await repository.deleteExpired(past)).toBe(0);

  expect(await repository.findActive('sc-live', past)).toEqual({ expiresAt: around(1), user });
  // Gone, not just expired: the id hash may be stored again.
  await repository.create({ idHash: 'sc-old', userId: user.id, createdAt: past, expiresAt: at });
  expect(await repository.findActive('sc-old', past)).toEqual({ expiresAt: at, user });
}

/** The contract of `SessionRepository`, for the D1 adapter and the in-memory double. */
export function describeSessionContract(name: string, harness: Harness): void {
  describe(`${name} sessions`, () => {
    it('finds an unexpired session with its user, and not once expired or deleted', () =>
      findsUntilExpiry(harness()));
    it('rejects a second session with the same id hash, keeping the first', () =>
      rejectsTakenHash(harness()));
    it('rejects a session of a user that does not exist', () => rejectsUnknownUser(harness()));
    it('deletes the sessions that expired at or before now, and only those', () =>
      deletesExpired(harness()));
  });
}
