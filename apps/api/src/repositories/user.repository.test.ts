import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { createUserRepository } from './user.repository.js';

const at = new Date('2026-01-01T00:00:00.000Z');

describe('createUserRepository (local D1)', () => {
  const repository = createUserRepository(env.DB);

  it('inserts a new user and finds it by id', async () => {
    const user = await repository.upsertByGithubId({
      id: 'user-1',
      githubId: 101,
      login: 'octocat',
      avatarUrl: 'https://avatars.test/101',
      now: at,
    });

    expect(user).toEqual({
      id: 'user-1',
      githubId: 101,
      login: 'octocat',
      avatarUrl: 'https://avatars.test/101',
    });
    expect(await repository.findById('user-1')).toEqual(user);
    expect(await repository.findById('user-none')).toBeNull();
  });

  it('keeps the id of a returning user and refreshes login, avatar and last login', async () => {
    await repository.upsertByGithubId({
      id: 'user-2',
      githubId: 202,
      login: 'old-login',
      avatarUrl: 'https://avatars.test/old',
      now: at,
    });

    const again = await repository.upsertByGithubId({
      id: 'user-unused',
      githubId: 202,
      login: 'new-login',
      avatarUrl: 'https://avatars.test/new',
      now: new Date(at.getTime() + 1000),
    });

    expect(again).toEqual({
      id: 'user-2',
      githubId: 202,
      login: 'new-login',
      avatarUrl: 'https://avatars.test/new',
    });
    const row = await env.DB.prepare('SELECT last_login_at FROM users WHERE id = ?')
      .bind('user-2')
      .first<{ last_login_at: number }>();
    expect(row?.last_login_at).toBe(at.getTime() + 1000);
    expect(await repository.findById('user-unused')).toBeNull();
  });
});
