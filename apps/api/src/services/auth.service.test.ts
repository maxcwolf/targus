import { describe, expect, it } from 'vitest';

import { newProject } from '../../test/support/fixtures.ts';
import { signInReviewer } from '../../test/support/in-memory-auth.ts';
import { createTestDeps, testConfig } from '../../test/support/in-memory.ts';
import {
  authenticateAdmin,
  authenticateProjectToken,
  authenticateSession,
} from './auth.service.ts';

describe('authenticateAdmin', () => {
  it('accepts the configured admin token', async () => {
    await expect(authenticateAdmin(createTestDeps(), 'admin-secret')).resolves.toBeUndefined();
  });

  it('rejects a missing or wrong token', async () => {
    const deps = createTestDeps();

    await expect(authenticateAdmin(deps, null)).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(authenticateAdmin(deps, 'guess')).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects everything when no admin token is configured', async () => {
    const deps = createTestDeps({ config: { ...testConfig, adminToken: null } });

    await expect(authenticateAdmin(deps, 'admin-secret')).rejects.toThrow('admin API is disabled');
  });
});

describe('authenticateProjectToken', () => {
  it('finds the project by the hash of its token', async () => {
    const deps = createTestDeps();
    const tokenHash = await deps.tokens.hash('project-token');
    const project = await deps.projects.create(newProject('auth', { tokenHash }));

    expect(await authenticateProjectToken(deps, 'project-token')).toEqual(project);
  });

  it('rejects a missing or unknown token', async () => {
    const deps = createTestDeps();

    await expect(authenticateProjectToken(deps, null)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    await expect(authenticateProjectToken(deps, 'nope')).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });
});

describe('authenticateSession', () => {
  it('returns the reviewer of an active session', async () => {
    const deps = createTestDeps();
    const reviewer = await signInReviewer(deps, 'octocat');

    expect(await authenticateSession(deps, reviewer.sessionId)).toEqual(reviewer);
  });

  it('looks the session up by the hash of the id, so a stored hash is not a session id', async () => {
    const deps = createTestDeps();
    await signInReviewer(deps, 'octocat');
    const [storedHash = ''] = deps.sessions.all.keys();

    await expect(authenticateSession(deps, storedHash)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('rejects a missing, unknown or expired session', async () => {
    const deps = createTestDeps();
    const reviewer = await signInReviewer(deps, 'octocat');
    deps.clock.advance(24 * 60 * 60 * 1000);

    for (const sessionId of [null, 'nope', reviewer.sessionId]) {
      await expect(authenticateSession(deps, sessionId)).rejects.toMatchObject({
        code: 'unauthorized',
      });
    }
  });
});
