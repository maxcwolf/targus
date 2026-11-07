import { env } from 'cloudflare:workers';

import { describeMembershipContract } from '../../test/support/contracts/membership.contract.ts';
import { newProject } from '../../test/support/fixtures.ts';
import {
  createInMemoryMemberships,
  createInMemoryUsers,
} from '../../test/support/in-memory-auth.ts';
import { createInMemoryProjects } from '../../test/support/in-memory.ts';
import { createMembershipRepository } from './membership.repository.ts';
import { createOrgRepository } from './org.repository.ts';
import { createUserRepository } from './user.repository.ts';

const at = new Date('2026-01-01T00:00:00.000Z');
let githubId = 9400;

describeMembershipContract('createMembershipRepository (local D1)', () => ({
  repository: createMembershipRepository(env.DB),
  async seed(userId, orgId) {
    githubId += 1;
    const org = {
      id: orgId,
      githubOrg: orgId,
      installationId: null,
      githubAccountId: null,
      createdAt: at,
    };
    await createOrgRepository(env.DB).insert(org);
    const avatarUrl = `https://avatars.test/${userId}`;
    const user = { id: userId, githubId, login: userId, avatarUrl, now: at };
    await createUserRepository(env.DB).upsertByGithubId(user);
  },
}));

describeMembershipContract('in-memory membership double', () => {
  const users = createInMemoryUsers();
  const projects = createInMemoryProjects();
  return {
    repository: createInMemoryMemberships({ users, orgs: projects }),
    async seed(userId, orgId) {
      githubId += 1;
      await projects.create(newProject(orgId, { newOrgId: orgId, githubOrg: orgId }));
      const avatarUrl = `https://avatars.test/${userId}`;
      await users.upsertByGithubId({ id: userId, githubId, login: userId, avatarUrl, now: at });
    },
  };
});
