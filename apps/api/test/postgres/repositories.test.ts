import { createFakeClock, createFakeIdGenerator } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { createPostgresOrgRepository } from '../../src/postgres/org.repository.ts';
import { describeApprovalContract } from '../support/contracts/approval.contract.ts';
import { describeImageContract } from '../support/contracts/image.contract.ts';
import { describeMembershipContract } from '../support/contracts/membership.contract.ts';
import { describeProjectContract } from '../support/contracts/project.contract.ts';
import { describeSessionContract } from '../support/contracts/session.contract.ts';
import { describeUserContract } from '../support/contracts/user.contract.ts';
import { newProject } from '../support/fixtures.ts';
import { openTestPostgres } from './database.ts';

const postgres = await openTestPostgres('repositories');
const { repositories } = postgres;
const orgs = createPostgresOrgRepository(postgres.db);
const at = new Date('2026-01-01T00:00:00.000Z');
let githubId = 9400;

describeProjectContract('createPostgresProjectRepository (Postgres)', () => repositories.projects);
describeUserContract('createPostgresUserRepository (Postgres)', () => repositories.users);

describeSessionContract('createPostgresSessionRepository (Postgres)', () => ({
  repository: repositories.sessions,
  users: repositories.users,
}));

describeApprovalContract('createPostgresApprovalRepository (Postgres)', () => ({
  repository: repositories.approvals,
  async seedProject(key) {
    return (await repositories.projects.create(newProject(key))).id;
  },
}));

describeMembershipContract('createPostgresMembershipRepository (Postgres)', () => ({
  repository: repositories.memberships,
  async seed(userId, orgId) {
    githubId += 1;
    await orgs.insert({
      id: orgId,
      githubOrg: orgId,
      installationId: null,
      githubAccountId: null,
      createdAt: at,
    });
    const avatarUrl = `https://avatars.test/${userId}`;
    await repositories.users.upsertByGithubId({
      id: userId,
      githubId,
      login: userId,
      avatarUrl,
      now: at,
    });
  },
}));

interface ImageRow {
  hash: string;
  size_bytes: number;
  width: number;
  height: number;
  last_referenced_at: Date;
}

describeImageContract('createPostgresImageRepository (Postgres)', () => ({
  images: repositories.images,
  projects: repositories.projects,
  users: repositories.users,
  memberships: repositories.memberships,
  async stored(hash) {
    const [row] = await postgres.rows<ImageRow>('SELECT * FROM images WHERE hash = $1', [hash]);
    if (row === undefined) return null;
    const { size_bytes: sizeBytes, width, height, last_referenced_at: lastReferencedAt } = row;
    return { hash: row.hash, sizeBytes, width, height, lastReferencedAt };
  },
}));

describe('createPostgresOrgRepository (Postgres)', () => {
  it('inserts an org and reads it back', async () => {
    const org = {
      id: createFakeIdGenerator('org').next(),
      githubOrg: 'example-org',
      installationId: 4242,
      githubAccountId: 7001,
      createdAt: createFakeClock().now(),
    };

    await orgs.insert(org);

    expect(await orgs.findById(org.id)).toEqual(org);
  });

  it('returns null for an org that does not exist', async () => {
    expect(await orgs.findById('org-missing')).toBeNull();
  });
});

// What the interfaces never return, so only the rows can show it.
describe('Postgres rows the interfaces do not return (Postgres)', () => {
  it('stores the time of the latest sign-in', async () => {
    const user = { id: 'user-ll', githubId: 9501, login: 'll', avatarUrl: 'https://a.test/ll' };
    await repositories.users.upsertByGithubId({ ...user, now: at });
    await repositories.users.upsertByGithubId({ ...user, now: new Date(at.getTime() + 1000) });

    const rows = await postgres.rows<{ last_login_at: Date }>(
      'SELECT last_login_at FROM users WHERE id = $1',
      ['user-ll'],
    );
    expect(rows).toEqual([{ last_login_at: new Date(at.getTime() + 1000) }]);
  });

  it('keeps the time of the first upload of an image by a project', async () => {
    await repositories.projects.create(newProject('up-first'));
    const hash = 'up-first'.padEnd(64, 'f');
    await repositories.images.recordUpload('project-up-first', hash, at);
    await repositories.images.recordUpload('project-up-first', hash, new Date(at.getTime() + 5));

    const rows = await postgres.rows<{ created_at: Date }>(
      'SELECT created_at FROM project_images WHERE project_id = $1 AND hash = $2',
      ['project-up-first', hash],
    );
    expect(rows).toEqual([{ created_at: at }]);
  });
});
