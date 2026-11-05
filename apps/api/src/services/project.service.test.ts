import { CreateProjectResponse } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { createTestDeps } from '../../test/support/in-memory.js';
import { authenticateProjectToken } from './auth.service.js';
import { createProject } from './project.service.js';

const request = {
  githubOrg: 'example-org',
  installationId: 42,
  repo: 'example-org/example-app',
  name: 'the pilot app',
  defaultBranch: 'main',
};

describe('createProject', () => {
  it('creates the project and returns a token that authenticates it', async () => {
    const deps = createTestDeps();

    const response = await createProject(deps, request);

    expect(CreateProjectResponse.parse(response)).toEqual(response);
    expect(response.project).toEqual({
      id: 'id-1',
      orgId: 'id-2',
      repo: 'example-org/example-app',
      name: 'the pilot app',
      defaultBranch: 'main',
    });
    expect(response.token).toHaveLength(48);
    expect((await authenticateProjectToken(deps, response.token)).id).toBe('id-1');
  });

  it('refuses a second project for the same repo', async () => {
    const deps = createTestDeps();
    await createProject(deps, request);

    await expect(createProject(deps, request)).rejects.toMatchObject({ code: 'conflict' });
  });
});
