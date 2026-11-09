import { describe, expect, it } from 'vitest';

import type { ProjectRepository } from '../../../src/ports/project-repository.ts';
import { newProject } from '../fixtures.ts';

/** A projects repository, D1's or the double's, called once per test. */
type Harness = () => ProjectRepository;

async function findsByEveryKey(repository: ProjectRepository): Promise<void> {
  const created = await repository.create(newProject('pc-find', { installationId: 77 }));

  expect(created).toEqual({
    id: 'project-pc-find',
    orgId: 'org-pc-find',
    repo: 'org-pc-find/app',
    name: 'App pc-find',
    defaultBranch: 'main',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    org: { githubOrg: 'org-pc-find', installationId: 77, githubAccountId: null },
  });
  expect(await repository.findById('project-pc-find')).toEqual(created);
  expect(await repository.findByRepo('org-pc-find/app')).toEqual(created);
  expect(await repository.findByTokenHash('token-hash-pc-find')).toEqual(created);
  expect(await repository.findById('nope')).toBeNull();
  expect(await repository.findByRepo('nope/nope')).toBeNull();
  expect(await repository.findByTokenHash('nope')).toBeNull();
}

async function sharesTheOrg(repository: ProjectRepository): Promise<void> {
  const org = { githubOrg: 'pc-shared', newOrgId: 'org-pc-shared' };
  const first = await repository.create(newProject('pc-org-1', org));
  const second = await repository.create(
    newProject('pc-org-2', { ...org, newOrgId: 'org-unused', installationId: 9 }),
  );
  const third = await repository.create(
    newProject('pc-org-3', { ...org, newOrgId: 'org-unused-2', installationId: null }),
  );

  expect(first.org).toEqual({
    githubOrg: 'pc-shared',
    installationId: null,
    githubAccountId: null,
  });
  expect([second.orgId, third.orgId]).toEqual(['org-pc-shared', 'org-pc-shared']);
  expect(third.org).toEqual({ githubOrg: 'pc-shared', installationId: 9, githubAccountId: null });
  // The org is one row: the project created before the installation id was known sees it too.
  expect((await repository.findById(first.id))?.org.installationId).toBe(9);
  expect((await repository.findByRepo(first.repo))?.org.installationId).toBe(9);
}

async function rejectsClashes(repository: ProjectRepository): Promise<void> {
  const first = await repository.create(newProject('pc-dup'));
  const clashes = [
    newProject('pc-dup-id', { id: first.id }),
    newProject('pc-dup-repo', { repo: first.repo }),
    newProject('pc-dup-token', { tokenHash: 'token-hash-pc-dup' }),
  ];

  for (const clash of clashes) await expect(repository.create(clash)).rejects.toThrow();

  expect(await repository.findById(first.id)).toEqual(first);
  expect(await repository.findByRepo(first.repo)).toEqual(first);
  expect(await repository.findByTokenHash('token-hash-pc-dup')).toEqual(first);
  expect(await repository.findById('project-pc-dup-repo')).toBeNull();
  expect(await repository.findByTokenHash('token-hash-pc-dup-id')).toBeNull();
}

async function listsByName(repository: ProjectRepository): Promise<void> {
  const named = [
    ['pc-l-b', 'pc-list b'],
    ['pc-l-t2', 'pc-list tie'],
    ['pc-l-B', 'pc-list B'],
    ['pc-l-t1', 'pc-list tie'],
    ['pc-l-a', 'pc-list a'],
  ] as const;
  for (const [key, name] of named) await repository.create(newProject(key, { name }));

  const listed = (await repository.listAll()).filter((p) => p.name.startsWith('pc-list'));

  // Text compares by code unit, as SQLite does: upper case sorts before lower case.
  expect(listed.map((project) => project.id)).toEqual(
    ['pc-l-B', 'pc-l-a', 'pc-l-b', 'pc-l-t1', 'pc-l-t2'].map((key) => `project-${key}`),
  );
}

async function storesTheAccountId(repository: ProjectRepository): Promise<void> {
  const org = { githubOrg: 'pc-account', newOrgId: 'org-pc-account', installationId: 21 };
  const first = await repository.create(newProject('pc-acct-1', org));

  // Read through another installation: the org has moved on, so the id is not stored.
  await repository.setOrgAccountId(first.orgId, 99, 5001);
  expect((await repository.findById(first.id))?.org.githubAccountId).toBeNull();

  await repository.setOrgAccountId(first.orgId, 21, 5021);
  const second = await repository.create(newProject('pc-acct-2', { ...org, newOrgId: 'x' }));
  const third = await repository.create(
    newProject('pc-acct-3', { ...org, newOrgId: 'y', installationId: null }),
  );

  expect(second.org).toEqual({
    githubOrg: 'pc-account',
    installationId: 21,
    githubAccountId: 5021,
  });
  expect(third.org.githubAccountId).toBe(5021);
  expect((await repository.findById(first.id))?.org.githubAccountId).toBe(5021);
  expect(
    (await repository.listAll()).filter((p) => p.orgId === first.orgId).map((p) => p.org),
  ).toEqual(Array(3).fill({ githubOrg: 'pc-account', installationId: 21, githubAccountId: 5021 }));
}

async function clearsTheAccountIdOnANewInstallation(repository: ProjectRepository): Promise<void> {
  const org = { githubOrg: 'pc-reinstall', newOrgId: 'org-pc-reinstall', installationId: 31 };
  const first = await repository.create(newProject('pc-re-1', org));
  await repository.setOrgAccountId(first.orgId, 31, 5031);

  const moved = await repository.create(
    newProject('pc-re-2', { ...org, newOrgId: 'z', installationId: 32 }),
  );

  // The id belonged to installation 31; it is read again from 32.
  expect(moved.org).toEqual({
    githubOrg: 'pc-reinstall',
    installationId: 32,
    githubAccountId: null,
  });
  expect((await repository.findByRepo(first.repo))?.org.githubAccountId).toBeNull();
}

/** The contract of `ProjectRepository`, for the D1 adapter and the in-memory double. */
export function describeProjectContract(name: string, harness: Harness): void {
  describe(`${name} projects`, () => {
    it('creates the org with the project and finds it by id, repo and token hash', () =>
      findsByEveryKey(harness()));
    it('reuses an existing org, and every project of it sees an installation id filled in', () =>
      sharesTheOrg(harness()));
    it("stores the org's account id for every project, only for its current installation", () =>
      storesTheAccountId(harness()));
    it('clears the account id when the org moves to another installation', () =>
      clearsTheAccountIdOnANewInstallation(harness()));
    it('rejects a project whose id, repo or token hash is taken, keeping the first', () =>
      rejectsClashes(harness()));
    it('lists every project by name as SQLite compares text, then by id', () =>
      listsByName(harness()));
  });
}
