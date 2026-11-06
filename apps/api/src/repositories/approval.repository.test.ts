import { env } from 'cloudflare:workers';

import { describeApprovalContract } from '../../test/support/contracts/approval.contract.ts';
import { newProject } from '../../test/support/fixtures.ts';
import { createInMemoryApprovals } from '../../test/support/in-memory.ts';
import { createApprovalRepository } from './approval.repository.ts';
import { createProjectRepository } from './project.repository.ts';

describeApprovalContract('createApprovalRepository (local D1)', () => ({
  repository: createApprovalRepository(env.DB),
  async seedProject(key) {
    return (await createProjectRepository(env.DB).create(newProject(key))).id;
  },
}));

describeApprovalContract('in-memory approvals double', () => ({
  repository: createInMemoryApprovals(),
  seedProject: (key) => Promise.resolve(`project-${key}`),
}));
