import { baselineResolutionCases, baselineShaOrder, emptyTally } from '@targus/core';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { newBuild, newProject, sha, snapshotRecord } from '../../test/support/fixtures.js';
import { completion } from '../../test/support/in-memory.js';
import { D1BuildRepository } from './build.repository.js';
import { createProjectRepository } from './project.repository.js';

const repository = new D1BuildRepository(env.DB);
const done = completion('pending', new Date('2026-01-02T00:00:00.000Z'));

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
    expect(first).toEqual({ ...newBuild('a1', projectA), number: 1, tally: emptyTally });
    expect(first.checkRunId).toBeNull();
    expect(await repository.findById(projectA, 'a2')).toEqual(second);
    expect(await repository.findById(projectB, 'a2')).toBeNull();
  });

  it('updates status, completion time and check run id', async () => {
    const projectId = await seedProject('status');
    await repository.create(newBuild('s1', projectId));

    const completed = await repository.completeWithResults('s1', [], {
      status: 'pending',
      tally: emptyTally,
      completedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    await repository.setCheckRunId('s1', 55);

    expect(completed).toBe(true);

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

const tally = {
  counts: { unchanged: 1, changed: 2, new: 3, removed: 4, unstable: 5, error: 6 },
  pendingCount: 7,
  deniedCount: 8,
};

describe('D1BuildRepository tallies and unscoped reads (local D1)', () => {
  it('stores the tally on completion and reads builds of any project', async () => {
    const projectId = await seedProject('tally');
    await repository.create(newBuild('t1', projectId));

    await repository.completeWithResults('t1', [], {
      status: 'denied',
      tally,
      completedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    expect(await repository.findAnyById('t1')).toMatchObject({ status: 'denied', tally });

    expect(await repository.findAnyById('t-none')).toBeNull();
  });

  it('creates a build with a given tally', async () => {
    const projectId = await seedProject('tally-create');

    expect((await repository.create(newBuild('tc1', projectId), tally)).tally).toEqual(tally);
  });

  it('lists the newest builds of a project first, up to the limit', async () => {
    const projectId = await seedProject('list');
    const otherId = await seedProject('list-other');
    for (const id of ['l1', 'l2', 'l3']) await repository.create(newBuild(id, projectId));
    await repository.create(newBuild('l-other', otherId));

    const listed = await repository.listForProject(projectId, { limit: 2 });

    expect(listed.builds.map((build) => [build.id, build.number])).toEqual([
      ['l3', 3],
      ['l2', 2],
    ]);
    expect(listed.nextCursor).not.toBeNull();
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
        title: index === 2 ? null : 'Stories/Button',
        name: index === 2 ? null : `Button ${index}`,
      }),
    );

    await repository.completeWithResults('snap-build', [...records].reverse(), done);

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

    await repository.completeWithResults('err-build', [record], done);

    expect(await repository.listSnapshots('err-build')).toEqual([record]);
  });
});

describe('D1BuildRepository.findLatestBaselineOnBranch', () => {
  it('finds the newest signed-off build of the branch within the project', async () => {
    const projectId = await seedProject('library-a');
    const otherId = await seedProject('library-b');
    await repository.create(newBuild('lib-1', projectId, { status: 'passed' }));
    await repository.create(newBuild('lib-2', projectId, { status: 'accepted' }));
    await repository.create(newBuild('lib-3', projectId, { status: 'pending' }));
    await repository.create(newBuild('lib-4', projectId, { status: 'accepted', branch: 'dev' }));
    await repository.create(newBuild('lib-5', otherId, { status: 'failed' }));

    expect((await repository.findLatestBaselineOnBranch(projectId, 'main'))?.id).toBe('lib-2');
    expect((await repository.findLatestBaselineOnBranch(projectId, 'dev'))?.id).toBe('lib-4');
    expect(await repository.findLatestBaselineOnBranch(otherId, 'main')).toBeNull();
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
