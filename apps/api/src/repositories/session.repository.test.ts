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
    const session = { idHash: 'hash-s1', userId: user.id, createdAt: at };
    await repository.create({ ...session, expiresAt: later(1000) });

    expect(await repository.findActive('hash-s1', later(999))).toEqual({
      expiresAt: later(1000),
      user,
    });
    expect(await repository.findActive('hash-s1', later(1000))).toBeNull();
    expect(await repository.findActive('hash-none', at)).toBeNull();

    await repository.delete('hash-s1');
    expect(await repository.findActive('hash-s1', at)).toBeNull();
  });

  it('deletes the sessions that expired at or before now, and only those', async () => {
    const user = await createUserRepository(env.DB).upsertByGithubId({
      id: 'user-expiry',
      githubId: 304,
      login: 'expiry',
      avatarUrl: 'https://avatars.test/304',
      now: at,
    });
    // Far in the past, so sessions other tests left in the shared D1 are not expired by it.
    const past = new Date('2000-01-01T00:00:00.000Z');
    const at2000 = (ms: number) => new Date(past.getTime() + ms);
    for (const [idHash, expiresAt] of [
      ['hash-old', at2000(-1)],
      ['hash-edge', past],
      ['hash-live', at2000(1)],
    ] as const) {
      await repository.create({ idHash, userId: user.id, createdAt: at2000(-10), expiresAt });
    }

    expect(await repository.deleteExpired(past)).toBe(2);

    expect(await repository.findActive('hash-live', past)).not.toBeNull();
    const { results } = await env.DB.prepare(
      "SELECT id_hash FROM sessions WHERE id_hash IN ('hash-old', 'hash-edge', 'hash-live')",
    ).all<{ id_hash: string }>();
    expect(results.map((row) => row.id_hash)).toEqual(['hash-live']);
  });
});
