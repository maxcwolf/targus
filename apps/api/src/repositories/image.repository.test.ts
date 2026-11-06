import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { describeImageContract } from '../../test/support/contracts/image.contract.ts';
import { newBuild, newProject, snapshotRecord } from '../../test/support/fixtures.ts';
import {
  createInMemoryMemberships,
  createInMemoryUsers,
} from '../../test/support/in-memory-auth.ts';
import { createInMemoryImages } from '../../test/support/in-memory-images.ts';
import { completion, createInMemoryProjects } from '../../test/support/in-memory.ts';
import { D1BuildRepository } from './build.repository.ts';
import { createImageRepository } from './image.repository.ts';
import { createMembershipRepository } from './membership.repository.ts';
import { createProjectRepository } from './project.repository.ts';
import { createUserRepository } from './user.repository.ts';

interface ImageRow {
  hash: string;
  size_bytes: number;
  width: number;
  height: number;
  last_referenced_at: number;
}

describeImageContract('createImageRepository (local D1)', () => ({
  images: createImageRepository(env.DB),
  projects: createProjectRepository(env.DB),
  users: createUserRepository(env.DB),
  memberships: createMembershipRepository(env.DB),
  async stored(hash) {
    const row = await env.DB.prepare('SELECT * FROM images WHERE hash = ?')
      .bind(hash)
      .first<ImageRow>();
    if (row === null) return null;
    const { size_bytes: sizeBytes, width, height, last_referenced_at: last } = row;
    return { hash: row.hash, sizeBytes, width, height, lastReferencedAt: new Date(last) };
  },
}));

describeImageContract('in-memory images double', () => {
  const projects = createInMemoryProjects();
  const memberships = createInMemoryMemberships();
  const images = createInMemoryImages({ projects, memberships });
  return {
    images,
    projects,
    users: createInMemoryUsers(),
    memberships,
    stored: (hash) => Promise.resolve(images.records.get(hash) ?? null),
  };
});

const at = new Date('2026-01-01T00:00:00.000Z');

/** A distinct hash per tag. */
const tagged = (tag: string): string => tag.padEnd(64, 'f');

describe('migration 0003', () => {
  it('backfills the capture, baseline and diff of every snapshot as uploads of its project', async () => {
    const repository = createImageRepository(env.DB);
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
  it('keeps the time of the first upload, which the interface does not return', async () => {
    const repository = createImageRepository(env.DB);
    await createProjectRepository(env.DB).create(newProject('up-first'));
    const hash = tagged('up-first');
    await repository.recordUpload('project-up-first', hash, at);
    await repository.recordUpload('project-up-first', hash, new Date(at.getTime() + 5));

    const rows = await env.DB.prepare(
      'SELECT created_at FROM project_images WHERE project_id = ? AND hash = ?',
    )
      .bind('project-up-first', hash)
      .all<{ created_at: number }>();
    expect(rows.results).toEqual([{ created_at: at.getTime() }]);
  });
});
