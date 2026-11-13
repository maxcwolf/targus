import { CreateProjectResponse, ListInstallationReposResponse } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { newProject } from '../../test/support/fixtures.ts';
import { createRecordingGitHub } from '../../test/support/github-recorder.ts';
import { signInReviewer } from '../../test/support/in-memory-auth.ts';
import { createTestDeps } from '../../test/support/in-memory.ts';
import { createUnreachableGitHub } from '../../test/support/unreachable-github.ts';
import {
  createInstallationProject,
  listInstallationRepos,
  listInstallations,
} from './installation.service.ts';

const repos = [
  { repo: 'acme/web', defaultBranch: 'trunk' },
  { repo: 'acme/app', defaultBranch: 'main' },
];

/** Installation 7 is on the org `acme` (octocat is a member); 8 is on mona's own account. */
async function setup() {
  const github = createRecordingGitHub(
    { acme: ['octocat'] },
    {
      logins: { 7: 'acme', 8: 'mona', 9: null },
      accounts: { 8: 4242 },
      repos: { 7: repos, 8: [{ repo: 'mona/notes', defaultBranch: 'main' }] },
    },
  );
  const deps = createTestDeps({ github });
  const member = await signInReviewer(deps, 'octocat');
  const outsider = await signInReviewer(deps, 'outsider');
  const mona = await signInReviewer(deps, 'mona', 4242);
  return { deps, github, member, outsider, mona };
}

describe('listInstallationRepos', () => {
  it('lists the repositories an installation can see, in name order, with their projects', async () => {
    const { deps, member } = await setup();
    const existing = await deps.projects.create(
      newProject('web', { githubOrg: 'acme', installationId: 7, repo: 'acme/web' }),
    );

    const response = await listInstallationRepos(deps, member, 7);

    expect(ListInstallationReposResponse.parse(response)).toEqual(response);
    expect(response).toEqual({
      account: 'acme',
      repos: [
        { repo: 'acme/app', defaultBranch: 'main', projectId: null },
        { repo: 'acme/web', defaultBranch: 'trunk', projectId: existing.id },
      ],
    });
  });

  it('is for members of the account, its owner when it is a personal one', async () => {
    const { deps, member, outsider, mona } = await setup();

    await expect(listInstallationRepos(deps, outsider, 7)).rejects.toMatchObject({
      code: 'forbidden',
      message: 'you are not a member of acme',
    });
    await expect(listInstallationRepos(deps, member, 8)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect((await listInstallationRepos(deps, mona, 8)).repos.map((r) => r.repo)).toEqual([
      'mona/notes',
    ]);
    await expect(listInstallationRepos(deps, member, 9)).rejects.toMatchObject({
      code: 'not_found',
      message: 'no installation 9',
    });
  });
});

describe('createInstallationProject', () => {
  it('makes a project for the repository and answers its token once', async () => {
    const { deps, github, member } = await setup();

    const response = await createInstallationProject(deps, member, 7, { repo: 'acme/web' });

    expect(CreateProjectResponse.parse(response)).toEqual(response);
    expect(response.project).toMatchObject({
      repo: 'acme/web',
      name: 'web',
      defaultBranch: 'trunk',
    });
    const stored = await deps.projects.findById(response.project.id);
    expect(stored?.org).toEqual({
      githubOrg: 'acme',
      installationId: 7,
      githubAccountId: 7_000_007,
    });
    expect(await deps.projects.findByTokenHash(await deps.tokens.hash(response.token))).toEqual(
      stored,
    );
    // The account id came with the installation, so the first access check asks nothing more.
    expect(github.accountLookups).toEqual([]);
  });

  it('refuses a repository the installation cannot see, or that already has a project', async () => {
    const { deps, member } = await setup();
    await createInstallationProject(deps, member, 7, { repo: 'acme/app' });

    await expect(
      createInstallationProject(deps, member, 7, { repo: 'acme/secret' }),
    ).rejects.toMatchObject({
      code: 'not_found',
      message: 'the installation on acme cannot see acme/secret',
    });
    await expect(
      createInstallationProject(deps, member, 7, { repo: 'acme/app' }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(deps.projects.all).toHaveLength(1);
  });

  it('refuses a non-member, and an installation the App does not have', async () => {
    const { deps, member, outsider } = await setup();
    const request = { repo: 'acme/web' };

    await expect(createInstallationProject(deps, outsider, 7, request)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(createInstallationProject(deps, member, 9, request)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(deps.projects.all).toEqual([]);
  });
});

describe('listInstallations', () => {
  it('lists each account the reviewer has a project under once, in account order', async () => {
    const github = createRecordingGitHub({ acme: ['octocat'], zeta: ['octocat'], other: [] });
    const deps = createTestDeps({ github });
    const member = await signInReviewer(deps, 'octocat');
    const outsider = await signInReviewer(deps, 'outsider');
    for (const [key, githubOrg, installationId] of [
      ['z', 'zeta', 3],
      ['a1', 'acme', 7],
      ['a2', 'acme', 7],
      ['o', 'other', 5],
      ['none', 'bare', null],
    ] as const) {
      await deps.projects.create(newProject(key, { githubOrg, installationId }));
    }

    expect(await listInstallations(deps, member)).toEqual({
      installations: [
        { installationId: 7, account: 'acme' },
        { installationId: 3, account: 'zeta' },
      ],
      installUrl: 'https://github.test/apps/targus-test/installations/new',
    });
    expect((await listInstallations(deps, outsider)).installations).toEqual([]);
  });

  it('leaves out an account whose membership cannot be checked, and says so in the log', async () => {
    const github = createUnreachableGitHub(['octocat'], ['acme']);
    const deps = createTestDeps({ github });
    const member = await signInReviewer(deps, 'octocat');
    await deps.projects.create(newProject('a', { githubOrg: 'acme', installationId: 7 }));
    await deps.projects.create(newProject('b', { githubOrg: 'beta', installationId: 8 }));

    const { installations } = await listInstallations(deps, member);

    expect(installations).toEqual([{ installationId: 8, account: 'beta' }]);
  });
});
