import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { createSessionRepository } from './session.repository.js';
import { createUserRepository } from './user.repository.js';

const at = new Date('2026-01-01T00:00:00.000Z');
const later = (ms: number) => new Date(at.getTime() + ms);

describe('createSessionRepository (local D1)', () => {
  const repository = createSessionRepository(env.DB);

  it('finds an unexpired session with its user, and not after it expires or is deleted', async () => {
    const user = await createUserRepository(env.DB).upsertByGithubId({
      id: 'user-s',
      githubId: 303,
      login: 'reviewer',
      avatarUrl: 'https://avatars.test/303',
      now: at,
    });
    await repository.create({ id: 's1', userId: user.id, createdAt: at, expiresAt: later(1000) });

    expect(await repository.findActive('s1', later(999))).toEqual({
      sessionId: 's1',
      expiresAt: later(1000),
      user,
    });
    expect(await repository.findActive('s1', later(1000))).toBeNull();
    expect(await repository.findActive('s-none', at)).toBeNull();

    await repository.delete('s1');
    expect(await repository.findActive('s1', at)).toBeNull();
  });
});
