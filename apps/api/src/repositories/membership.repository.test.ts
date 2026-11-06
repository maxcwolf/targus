import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { createMembershipRepository } from './membership.repository.ts';
import { createOrgRepository } from './org.repository.ts';
import { createUserRepository } from './user.repository.ts';

const at = new Date('2026-01-01T00:00:00.000Z');

describe('createMembershipRepository (local D1)', () => {
  it('caches one answer per user and org, replacing it on set', async () => {
    await createOrgRepository(env.DB).insert({
      id: 'org-m',
      githubOrg: 'org-m',
      installationId: 1,
      createdAt: at,
    });
    await createUserRepository(env.DB).upsertByGithubId({
      id: 'user-m',
      githubId: 404,
      login: 'member',
      avatarUrl: 'https://avatars.test/404',
      now: at,
    });
    const repository = createMembershipRepository(env.DB);

    expect(await repository.get('user-m', 'org-m')).toBeNull();
    await repository.set('user-m', 'org-m', true, at);
    expect(await repository.get('user-m', 'org-m')).toEqual({ member: true, checkedAt: at });

    const recheck = new Date(at.getTime() + 3_600_000);
    await repository.set('user-m', 'org-m', false, recheck);
    expect(await repository.get('user-m', 'org-m')).toEqual({ member: false, checkedAt: recheck });
  });
});
