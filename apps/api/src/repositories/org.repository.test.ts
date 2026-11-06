import { createFakeClock, createFakeIdGenerator } from '@targus/core';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { createOrgRepository } from './org.repository.ts';

describe('createOrgRepository (local D1)', () => {
  it('inserts an org and reads it back', async () => {
    const repository = createOrgRepository(env.DB);
    const org = {
      id: createFakeIdGenerator('org').next(),
      githubOrg: 'example-org',
      installationId: 4242,
      githubAccountId: 7001,
      createdAt: createFakeClock().now(),
    };

    await repository.insert(org);

    expect(await repository.findById(org.id)).toEqual(org);
  });

  it('returns null for an org that does not exist', async () => {
    expect(await createOrgRepository(env.DB).findById('org-missing')).toBeNull();
  });
});
