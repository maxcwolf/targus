import { describe, expect, it } from 'vitest';

import { newProject } from '../../test/support/fixtures.js';
import { createTestDeps, testConfig } from '../../test/support/in-memory.js';
import { authenticateAdmin, authenticateProjectToken } from './auth.service.js';

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
