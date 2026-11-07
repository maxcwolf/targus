import { env } from 'cloudflare:workers';

import { describeApprovalContract } from '../../test/support/contracts/approval.contract.ts';
import { newProject } from '../../test/support/fixtures.ts';
import { createInMemoryApprovals, createInMemoryProjects } from '../../test/support/in-memory.ts';
import { createApprovalRepository } from './approval.repository.ts';
import { createProjectRepository } from './project.repository.ts';

describeApprovalContract('createApprovalRepository (local D1)', () => ({
  repository: createApprovalRepository(env.DB),
  async seedProject(key) {
    return (await createProjectRepository(env.DB).create(newProject(key))).id;
  },
}));

describeApprovalContract('in-memory approvals double', () => {
  const projects = createInMemoryProjects();
  return {
    repository: createInMemoryApprovals(projects),
    async seedProject(key) {
      return (await projects.create(newProject(key))).id;
    },
  };
});
