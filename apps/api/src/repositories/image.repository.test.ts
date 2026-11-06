import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { imageHash, newBuild, newProject, snapshotRecord } from '../../test/support/fixtures.js';
import { completion } from '../../test/support/in-memory.js';
import { D1BuildRepository } from './build.repository.js';
import { createImageRepository } from './image.repository.js';
import { createProjectRepository } from './project.repository.js';

const at = new Date('2026-01-01T00:00:00.000Z');

async function lastReferencedAt(hash: string): Promise<number | undefined> {
  const row = await env.DB.prepare('SELECT last_referenced_at FROM images WHERE hash = ?')
    .bind(hash)
    .first<{ last_referenced_at: number }>();
  return row?.last_referenced_at;
}

describe('createImageRepository (local D1)', () => {
  const repository = createImageRepository(env.DB);

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

describe('createImageRepository.projectIdsReferencing (local D1)', () => {
  const repository = createImageRepository(env.DB);

  it('finds the projects whose snapshots use a hash as image, baseline or diff', async () => {
    const projects = createProjectRepository(env.DB);
    const builds = new D1BuildRepository(env.DB);
    for (const key of ['ref-a', 'ref-b', 'ref-c']) {
      await projects.create(newProject(key));
      await builds.create(newBuild(`build-${key}`, `project-${key}`));
    }
    const [current, baseline, diff] = [imageHash('7'), imageHash('8'), imageHash('9')];
    const done = completion('pending', at);
    await builds.completeWithResults(
      'build-ref-a',
      [
        snapshotRecord('ref-1', 'build-ref-a', { imageHash: current, baselineHash: baseline }),
        snapshotRecord('ref-2', 'build-ref-a', { imageHash: current }),
      ],
      done,
    );
    await builds.completeWithResults(
      'build-ref-b',
      [snapshotRecord('ref-3', 'build-ref-b', { imageHash: imageHash('6'), diffHash: diff })],
      done,
    );
    await builds.completeWithResults(
      'build-ref-c',
      [snapshotRecord('ref-4', 'build-ref-c', { imageHash: baseline })],
      done,
    );

    expect(await repository.projectIdsReferencing(current)).toEqual(['project-ref-a']);
    expect((await repository.projectIdsReferencing(baseline)).sort()).toEqual([
      'project-ref-a',
      'project-ref-c',
    ]);
    expect(await repository.projectIdsReferencing(diff)).toEqual(['project-ref-b']);
    expect(await repository.projectIdsReferencing(imageHash('5'))).toEqual([]);
  });
});

describe('createImageRepository uploads (local D1)', () => {
  const repository = createImageRepository(env.DB);

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
