import { TargusError } from '@targus/core';

import type { Project } from '../repositories/project.repository.js';
import type { ServiceDeps } from './deps.js';

/** Admin routes: the presented bearer token must equal `ADMIN_TOKEN`, which must be set. */
export async function authenticateAdmin(
  deps: Pick<ServiceDeps, 'config' | 'tokens'>,
  presented: string | null,
): Promise<void> {
  const expected = deps.config.adminToken;
  if (expected === null) throw new TargusError('unauthorized', 'admin API is disabled');
  if (presented === null || !(await deps.tokens.equals(presented, expected))) {
    throw new TargusError('unauthorized', 'invalid admin token');
  }
}

/** CLI routes: the bearer token's hash must belong to a project. */
export async function authenticateProjectToken(
  deps: Pick<ServiceDeps, 'projects' | 'tokens'>,
  presented: string | null,
): Promise<Project> {
  if (presented === null) throw new TargusError('unauthorized', 'missing project token');
  const project = await deps.projects.findByTokenHash(await deps.tokens.hash(presented));
  if (project === null) throw new TargusError('unauthorized', 'invalid project token');
  return project;
}
