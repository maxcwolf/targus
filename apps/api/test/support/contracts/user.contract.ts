import { describe, expect, it } from 'vitest';

import type { UserLogin, UserRepository } from '../../../src/repositories/user.repository.ts';

/** A users repository, D1's or the double's, called once per test. */
type Harness = () => UserRepository;

const at = new Date('2026-01-01T00:00:00.000Z');

/** GitHub user `githubId` signing in as `login`, to be stored as `id` if new. */
function login(id: string, githubId: number, name: string): UserLogin {
  return { id, githubId, login: name, avatarUrl: `https://avatars.test/${name}`, now: at };
}

async function insertsAndFinds(repository: UserRepository): Promise<void> {
  const user = await repository.upsertByGithubId(login('uc-1', 9101, 'octocat'));

  expect(user).toEqual({
    id: 'uc-1',
    githubId: 9101,
    login: 'octocat',
    avatarUrl: 'https://avatars.test/octocat',
  });
  expect(await repository.findById('uc-1')).toEqual(user);
  expect(await repository.findById('uc-none')).toBeNull();
}

async function refreshesReturningUser(repository: UserRepository): Promise<void> {
  await repository.upsertByGithubId(login('uc-2', 9102, 'old-login'));

  const again = await repository.upsertByGithubId({
    ...login('uc-unused', 9102, 'new-login'),
    now: new Date(at.getTime() + 1000),
  });

  expect(again).toEqual({
    id: 'uc-2',
    githubId: 9102,
    login: 'new-login',
    avatarUrl: 'https://avatars.test/new-login',
  });
  expect(await repository.findById('uc-2')).toEqual(again);
  expect(await repository.findById('uc-unused')).toBeNull();
}

async function rejectsTakenId(repository: UserRepository): Promise<void> {
  const first = await repository.upsertByGithubId(login('uc-3', 9103, 'first'));

  await expect(repository.upsertByGithubId(login('uc-3', 9104, 'second'))).rejects.toThrow();

  expect(await repository.findById('uc-3')).toEqual(first);
  // The GitHub id that was refused is still free.
  expect((await repository.upsertByGithubId(login('uc-4', 9104, 'second'))).id).toBe('uc-4');
}

/** The contract of `UserRepository`, for the D1 adapter and the in-memory double. */
export function describeUserContract(name: string, harness: Harness): void {
  describe(`${name} users`, () => {
    it('inserts a new user and finds it by id', () => insertsAndFinds(harness()));
    it('keeps the id of a returning user and refreshes its login and avatar', () =>
      refreshesReturningUser(harness()));
    it('rejects a new GitHub id under an id another user has', () => rejectsTakenId(harness()));
  });
}
