import { baselineResolutionCases, baselineShaOrder } from '@targus/core';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { newBuild, newProject, sha, snapshotRecord } from '../../test/support/fixtures.js';
import { D1BuildRepository } from './build.repository.js';
import { createProjectRepository } from './project.repository.js';

const repository = new D1BuildRepository(env.DB);

async function seedProject(key: string): Promise<string> {
  const project = await createProjectRepository(env.DB).create(newProject(key));
  return project.id;
}

describe('D1BuildRepository (local D1)', () => {
  it('numbers builds per project and reads them back scoped by project', async () => {
    const projectA = await seedProject('builds-a');
    const projectB = await seedProject('builds-b');

    const first = await repository.create(newBuild('a1', projectA));
    const second = await repository.create(newBuild('a2', projectA, { prNumber: 12 }));
    const other = await repository.create(newBuild('b1', projectB));

    expect([first.number, second.number, other.number]).toEqual([1, 2, 1]);
    expect(first).toEqual({ ...newBuild('a1', projectA), number: 1 });
    expect(first.checkRunId).toBeNull();
    expect(await repository.findById(projectA, 'a2')).toEqual(second);
    expect(await repository.findById(projectB, 'a2')).toBeNull();
  });

  it('updates status, completion time and check run id', async () => {
    const projectId = await seedProject('status');
    await repository.create(newBuild('s1', projectId));

    await repository.updateStatus('s1', 'pending', new Date('2026-01-02T00:00:00.000Z'), 55);

    expect(await repository.findById(projectId, 's1')).toMatchObject({
      status: 'pending',
      completedAt: '2026-01-02T00:00:00.000Z',
      checkRunId: 55,
    });
    const row = await env.DB.prepare('SELECT check_run_id FROM builds WHERE id = ?')
      .bind('s1')
      .first<{ check_run_id: number | null }>();
    expect(row?.check_run_id).toBe(55);
  });
});

describe('D1BuildRepository snapshots (local D1)', () => {
  it('saves and lists snapshots in story order, in chunks under the D1 parameter limit', async () => {
    const projectId = await seedProject('snapshots');
    await repository.create(newBuild('snap-build', projectId));
    const records = Array.from({ length: 20 }, (_, index) =>
      snapshotRecord(`snap-${String(index).padStart(2, '0')}`, 'snap-build', {
        blank: index === 0,
        reviewedAt: index === 1 ? '2026-01-03T00:00:00.000Z' : null,
        reviewedBy: index === 1 ? 'octocat' : null,
      }),
    );

    await repository.saveSnapshots('snap-build', [...records].reverse());
    await repository.saveSnapshots('snap-build', []);

    expect(await repository.listSnapshots('snap-build')).toEqual(records);
  });

  it('stores error snapshots with their message and no image', async () => {
    const projectId = await seedProject('errors');
    await repository.create(newBuild('err-build', projectId));
    const record = snapshotRecord('err-1', 'err-build', {
      state: 'error',
      imageHash: null,
      width: null,
      height: null,
      error: 'TypeError: boom',
    });

    await repository.saveSnapshots('err-build', [record]);

    expect(await repository.listSnapshots('err-build')).toEqual([record]);
  });
});

describe('D1BuildRepository.findLatestSuccessfulForShas agrees with resolveBaseline', () => {
  it.each(baselineResolutionCases.map((testCase, index) => ({ ...testCase, index })))(
    '$name',
    async ({ index, mergeBaseSha, ancestors, candidates, expectedBuildId }) => {
      const projectId = await seedProject(`case-${index}`);
      const prefix = `case-${index}-`;
      for (const candidate of candidates) {
        await repository.create(
          newBuild(`${prefix}${candidate.id}`, projectId, {
            sha: candidate.sha,
            status: candidate.status,
            createdAt: candidate.createdAt,
          }),
        );
      }

      const found = await repository.findLatestSuccessfulForShas(
        projectId,
        baselineShaOrder(mergeBaseSha, ancestors),
      );

      expect(found?.id ?? null).toBe(
        expectedBuildId === null ? null : `${prefix}${expectedBuildId}`,
      );
    },
  );

  it('handles the full 101-sha order the CLI can send in one query', async () => {
    const projectId = await seedProject('long-order');
    const ancestors = Array.from({ length: 100 }, (_, index) =>
      index.toString(16).padStart(40, '0'),
    );
    const last = ancestors.at(-1) ?? sha('f');
    await repository.create(newBuild('long-1', projectId, { sha: last, status: 'passed' }));

    const found = await repository.findLatestSuccessfulForShas(
      projectId,
      baselineShaOrder(sha('e'), ancestors),
    );

    expect(found?.id).toBe('long-1');
  });

  it('ignores builds of other projects', async () => {
    const projectId = await seedProject('scoped-a');
    const otherId = await seedProject('scoped-b');
    await repository.create(newBuild('scoped-1', otherId, { sha: sha('a'), status: 'passed' }));

    expect(await repository.findLatestSuccessfulForShas(projectId, [sha('a')])).toBeNull();
  });
});
