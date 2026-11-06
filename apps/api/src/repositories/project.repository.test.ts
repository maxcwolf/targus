import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { newProject } from '../../test/support/fixtures.ts';
import { createProjectRepository } from './project.repository.ts';

describe('createProjectRepository (local D1)', () => {
  const repository = createProjectRepository(env.DB);

  it('creates the org with the project and finds it by id, repo and token hash', async () => {
    const created = await repository.create(newProject('p1', { installationId: 77 }));

    expect(created).toEqual({
      id: 'project-p1',
      orgId: 'org-p1',
      repo: 'org-p1/app',
      name: 'App p1',
      defaultBranch: 'main',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      org: { githubOrg: 'org-p1', installationId: 77 },
    });
    expect(await repository.findById('project-p1')).toEqual(created);
    expect(await repository.findByRepo('org-p1/app')).toEqual(created);
    expect(await repository.findByTokenHash('token-hash-p1')).toEqual(created);
  });

  it('reuses an existing org and fills in its installation id once known', async () => {
    await repository.create(newProject('p2', { githubOrg: 'shared', newOrgId: 'org-shared' }));
    const second = await repository.create(
      newProject('p3', { githubOrg: 'shared', newOrgId: 'org-unused', installationId: 9 }),
    );
    const third = await repository.create(
      newProject('p4', { githubOrg: 'shared', newOrgId: 'org-unused-2', installationId: null }),
    );

    expect(second.orgId).toBe('org-shared');
    expect(second.org).toEqual({ githubOrg: 'shared', installationId: 9 });
    expect(third.org.installationId).toBe(9);
    expect((await repository.findById('project-p2'))?.org.installationId).toBe(9);
  });

  it('returns null for unknown ids, repos and token hashes', async () => {
    expect(await repository.findById('nope')).toBeNull();
    expect(await repository.findByRepo('nope/nope')).toBeNull();
    expect(await repository.findByTokenHash('nope')).toBeNull();
  });

  it('lists every project ordered by name', async () => {
    await repository.create(newProject('list-b', { name: 'zzz last' }));
    await repository.create(newProject('list-a', { name: 'AAA first' }));

    const names = (await repository.listAll()).map((project) => project.name);

    expect(names[0]).toBe('AAA first');
    expect(names.at(-1)).toBe('zzz last');
    expect([...names].sort()).toEqual(names);
  });
});
