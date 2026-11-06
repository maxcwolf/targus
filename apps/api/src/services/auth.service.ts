import { TargusError } from '@targus/core';

import type { Project } from '../repositories/project.repository.ts';
import type { ServiceDeps } from './deps.ts';
import type { Reviewer } from './principal.ts';

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

/**
 * Review routes: the session cookie's id must name a session that has not expired. Sessions are
 * stored by the SHA-256 of their id (ADR 0015), so the lookup hashes the cookie's value.
 */
export async function authenticateSession(
  deps: Pick<ServiceDeps, 'clock' | 'sessions' | 'tokens'>,
  sessionId: string | null,
): Promise<Reviewer> {
  if (sessionId === null) throw new TargusError('unauthorized', 'sign in with GitHub first');
  const idHash = await deps.tokens.hash(sessionId);
  const session = await deps.sessions.findActive(idHash, deps.clock.now());
  if (session === null) throw new TargusError('unauthorized', 'session expired; sign in again');
  return { sessionId, user: session.user };
}
