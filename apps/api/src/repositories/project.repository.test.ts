import { env } from 'cloudflare:workers';

import { describeProjectContract } from '../../test/support/contracts/project.contract.ts';
import { createInMemoryProjects } from '../../test/support/in-memory.ts';
import { createProjectRepository } from './project.repository.ts';

describeProjectContract('createProjectRepository (local D1)', () =>
  createProjectRepository(env.DB),
);
describeProjectContract('in-memory projects double', createInMemoryProjects);
