import { CreateProjectResponse, ListProjectsResponse } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { newProject } from '../../test/support/fixtures.js';
import { createRecordingGitHub } from '../../test/support/github-recorder.js';
import { signInReviewer } from '../../test/support/in-memory-auth.js';
import { createTestDeps } from '../../test/support/in-memory.js';
import { authenticateProjectToken } from './auth.service.js';
import { createProject, listProjects } from './project.service.js';

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

describe('listProjects', () => {
  it('lists only the projects of orgs the reviewer belongs to, sharing one lookup per org', async () => {
    const github = createRecordingGitHub(['octocat']);
    const deps = createTestDeps({ github });
    await deps.projects.create(newProject('b', { githubOrg: 'example-org', installationId: 1 }));
    await deps.projects.create(
      newProject('a', { githubOrg: 'example-org', newOrgId: 'org-b', installationId: 1 }),
    );
    await deps.projects.create(newProject('c', { githubOrg: 'elsewhere', installationId: 2 }));
    await deps.projects.create(newProject('d', { githubOrg: 'uninstalled' }));
    const reviewer = await signInReviewer(deps, 'octocat');

    const response = await listProjects(deps, reviewer);

    expect(ListProjectsResponse.parse(response)).toEqual(response);
    expect(response.projects).toEqual([
      {
        id: 'project-a',
        orgId: 'org-b',
        githubOrg: 'example-org',
        repo: 'org-a/app',
        name: 'App a',
        defaultBranch: 'main',
      },
      expect.objectContaining({ id: 'project-b' }),
      expect.objectContaining({ id: 'project-c' }),
    ]);
    expect(github.membershipChecks).toEqual([
      { org: 'example-org', login: 'octocat' },
      { org: 'elsewhere', login: 'octocat' },
    ]);
  });

  it('lists nothing for a reviewer outside every org', async () => {
    const deps = createTestDeps({ github: createRecordingGitHub([]) });
    await deps.projects.create(newProject('x', { installationId: 1 }));

    const response = await listProjects(deps, await signInReviewer(deps, 'outsider'));

    expect(response.projects).toEqual([]);
  });
});
