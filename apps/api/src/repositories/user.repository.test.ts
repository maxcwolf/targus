import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { describeUserContract } from '../../test/support/contracts/user.contract.ts';
import { createInMemoryUsers } from '../../test/support/in-memory-auth.ts';
import { createUserRepository } from './user.repository.ts';

describeUserContract('createUserRepository (local D1)', () => createUserRepository(env.DB));
describeUserContract('in-memory users double', createInMemoryUsers);

// The interface never returns the last login time, so only the D1 row can show it.
describe('createUserRepository last login (local D1)', () => {
  it('stores the time of the latest sign-in', async () => {
    const repository = createUserRepository(env.DB);
    const at = new Date('2026-01-01T00:00:00.000Z');
    const user = { id: 'user-ll', githubId: 9501, login: 'll', avatarUrl: 'https://a.test/ll' };
    await repository.upsertByGithubId({ ...user, now: at });
    await repository.upsertByGithubId({ ...user, now: new Date(at.getTime() + 1000) });

    const row = await env.DB.prepare('SELECT last_login_at FROM users WHERE id = ?')
      .bind('user-ll')
      .first<{ last_login_at: number }>();
    expect(row?.last_login_at).toBe(at.getTime() + 1000);
  });
});
