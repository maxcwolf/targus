import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { imageHash, newBuild, newProject, snapshotRecord } from '../../test/support/fixtures.js';
import { completion } from '../../test/support/in-memory.js';
import { D1BuildRepository } from './build.repository.js';
import { createImageRepository } from './image.repository.js';
import { createMembershipRepository } from './membership.repository.js';
import { createProjectRepository } from './project.repository.js';
import { createUserRepository } from './user.repository.js';

const at = new Date('2026-01-01T00:00:00.000Z');

async function lastReferencedAt(hash: string): Promise<number | undefined> {
  const row = await env.DB.prepare('SELECT last_referenced_at FROM images WHERE hash = ?')
    .bind(hash)
    .first<{ last_referenced_at: number }>();
  return row?.last_referenced_at;
}

const repository = createImageRepository(env.DB);

describe('createImageRepository (local D1)', () => {
  it('reports unrecorded hashes in input order', async () => {
    await repository.record({ hash: imageHash('a'), sizeBytes: 10, width: 1, height: 2 }, at);

    expect(await repository.missing([imageHash('b'), imageHash('a'), imageHash('c')])).toEqual([
      imageHash('b'),
      imageHash('c'),
    ]);
    expect(await repository.missing([])).toEqual([]);
  });

  it('answers for more hashes than D1 binds parameters', async () => {
    const hashes = Array.from({ length: 150 }, (_, index) => index.toString(16).padStart(64, '0'));
    await repository.record({ hash: hashes[0] ?? '', sizeBytes: 1, width: 1, height: 1 }, at);

    expect(await repository.missing(hashes)).toEqual(hashes.slice(1));
  });

  it('keeps the first record and bumps last_referenced_at on touch', async () => {
    const hash = imageHash('d');
    await repository.record({ hash, sizeBytes: 10, width: 1, height: 2 }, at);
    await repository.record(
      { hash, sizeBytes: 99, width: 9, height: 9 },
      new Date(at.getTime() + 5),
    );
    await repository.touch([hash, imageHash('e')], new Date(at.getTime() + 1000));
    await repository.touch([], new Date(at.getTime() + 2000));

    expect(await lastReferencedAt(hash)).toBe(at.getTime() + 1000);
    expect(await lastReferencedAt(imageHash('e'))).toBeUndefined();
  });
});

/** A distinct hash per tag, apart from the single-digit `imageHash` ones. */
const tagged = (tag: string): string => tag.padEnd(64, 'f');

/** A project `key` in org `org` (created by the first project that names it). */
function inOrg(key: string, org: string, installationId: number | null = null) {
  return newProject(key, { githubOrg: org, newOrgId: org, installationId });
}

describe('createImageRepository.uploaderOrgs (local D1)', () => {
  it('lists each org that uploaded a hash once, with the user cached membership', async () => {
    const projects = createProjectRepository(env.DB);
    await projects.create(inOrg('uo-x1', 'uo-x', 7));
    await projects.create(inOrg('uo-x2', 'uo-x'));
    await projects.create(inOrg('uo-y', 'uo-y'));
    await projects.create(inOrg('uo-z', 'uo-z'));
    await createUserRepository(env.DB).upsertByGithubId({
      id: 'user-uo',
      githubId: 4242,
      login: 'octocat',
      avatarUrl: 'https://avatars.test/4242',
      now: at,
    });
    await createMembershipRepository(env.DB).set('user-uo', 'uo-x', true, at);
    const [hash, unrelated] = [tagged('a1'), tagged('a2')];
    for (const key of ['uo-x1', 'uo-x2', 'uo-y'])
      await repository.recordUpload(`project-${key}`, hash, at);
    await repository.recordUpload('project-uo-z', unrelated, at);

    const found = await repository.uploaderOrgs(hash, 'user-uo');

    expect([...found].sort((a, b) => a.orgId.localeCompare(b.orgId))).toEqual([
      {
        orgId: 'uo-x',
        githubOrg: 'uo-x',
        installationId: 7,
        membership: { member: true, checkedAt: at },
      },
      { orgId: 'uo-y', githubOrg: 'uo-y', installationId: null, membership: null },
    ]);
    expect(await repository.uploaderOrgs(hash, 'user-nobody')).toHaveLength(2);
    expect(await repository.uploaderOrgs(tagged('a3'), 'user-uo')).toEqual([]);
  });

  it('has no cap on the number of orgs', async () => {
    const projects = createProjectRepository(env.DB);
    const hash = tagged('b1');
    for (let index = 0; index < 25; index += 1) {
      await projects.create(inOrg(`many-${index}`, `many-${index}`));
      await repository.recordUpload(`project-many-${index}`, hash, at);
    }

    expect(await repository.uploaderOrgs(hash, 'user-uo')).toHaveLength(25);
  });
});

describe('migration 0003', () => {
  it('backfills the capture, baseline and diff of every snapshot as uploads of its project', async () => {
    await createProjectRepository(env.DB).create(newProject('bf'));
    const builds = new D1BuildRepository(env.DB);
    await builds.create(newBuild('build-bf', 'project-bf'));
    const [capture, baseline, diff] = [tagged('c1'), tagged('c2'), tagged('c3')];
    const snapshot = { imageHash: capture, baselineHash: baseline, diffHash: diff };
    await builds.completeWithResults(
      'build-bf',
      [snapshotRecord('bf-1', 'build-bf', snapshot)],
      completion('pending', at),
    );
    expect(await repository.notUploadedBy('project-bf', [capture, baseline, diff])).toHaveLength(3);

    // The test database is already migrated; the backfill is INSERT OR IGNORE, so replay it.
    const migration = env.TEST_MIGRATIONS.find((found) => found.name.startsWith('0003'));
    const backfill = (migration?.queries ?? []).filter((query) => query.includes('INSERT'));
    expect(backfill).toHaveLength(3);
    for (const query of backfill) await env.DB.prepare(query).run();

    expect(await repository.notUploadedBy('project-bf', [capture, baseline, diff])).toEqual([]);
    for (const hash of [capture, baseline, diff]) {
      expect(await repository.uploaderOrgs(hash, 'user-bf')).toMatchObject([{ orgId: 'org-bf' }]);
    }
  });
});

describe('createImageRepository uploads (local D1)', () => {
  it('remembers uploads per project, once, and answers in input order', async () => {
    const projects = createProjectRepository(env.DB);
    await projects.create(newProject('up-a'));
    await projects.create(newProject('up-b'));
    const [one, two, three] = [imageHash('1'), imageHash('2'), imageHash('3')];
    await repository.recordUpload('project-up-a', one, at);
    await repository.recordUpload('project-up-a', one, new Date(at.getTime() + 5));
    await repository.recordUpload('project-up-b', two, at);

    expect(await repository.notUploadedBy('project-up-a', [three, one, two])).toEqual([three, two]);
    expect(await repository.notUploadedBy('project-up-b', [three, one, two])).toEqual([three, one]);
    expect(await repository.notUploadedBy('project-up-a', [])).toEqual([]);
    const rows = await env.DB.prepare(
      'SELECT created_at FROM project_images WHERE project_id = ? AND hash = ?',
    )
      .bind('project-up-a', one)
      .all<{ created_at: number }>();
    expect(rows.results).toEqual([{ created_at: at.getTime() }]);
  });

  it('answers for more hashes than D1 binds parameters', async () => {
    await createProjectRepository(env.DB).create(newProject('up-many'));
    const hashes = Array.from({ length: 150 }, (_, index) => index.toString(16).padStart(64, '0'));
    await repository.recordUpload('project-up-many', hashes[0] ?? '', at);

    expect(await repository.notUploadedBy('project-up-many', hashes)).toEqual(hashes.slice(1));
  });
});
