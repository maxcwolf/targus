import { CreateBuildResponse, GetBuildResponse, ListSnapshotsResponse } from '@targus/core';
import { describe, expect, it } from 'vitest';

import {
  captured,
  createBuildRequest,
  imageHash,
  newProject,
  sha,
  snapshotRecord,
} from '../../test/support/fixtures.js';
import { createTestDeps, type TestDeps } from '../../test/support/in-memory.js';
import type { SnapshotRecord } from '../repositories/build.repository.js';
import type { Project } from '../repositories/project.repository.js';
import { createBuild, getBuild, listSnapshots } from './build.service.js';

async function setup(): Promise<{ deps: TestDeps; project: Project }> {
  const deps = createTestDeps();
  return { deps, project: await deps.projects.create(newProject('svc')) };
}

describe('createBuild', () => {
  it('opens an in_progress build without a baseline and lists missing images', async () => {
    const { deps, project } = await setup();
    await deps.images.record(
      { hash: imageHash('1'), sizeBytes: 1, width: 1, height: 1 },
      deps.clock.now(),
    );
    deps.clock.advance(5000);

    const response = await createBuild(
      deps,
      project,
      createBuildRequest(sha('a'), {
        snapshots: [
          captured('a', imageHash('1')),
          captured('b', imageHash('2')),
          captured('c', imageHash('2')),
        ],
      }),
    );

    expect(CreateBuildResponse.parse(response)).toEqual({
      build: { id: 'id-1', number: 1 },
      baselineBuildId: null,
      baselines: [],
      missingImageHashes: [imageHash('2')],
    });
    expect(deps.builds.builds[0]).toMatchObject({ status: 'in_progress', completedAt: null });
    expect(deps.images.records.get(imageHash('1'))?.lastReferencedAt).toEqual(deps.clock.now());
  });
});

/** One baseline story in each review situation that decides its accepted image. */
function baselineRecords(baselineId: string): SnapshotRecord[] {
  return [
    snapshotRecord('s1', baselineId, {
      storyId: 'same',
      state: 'unchanged',
      review: 'approved',
      imageHash: imageHash('3'),
      baselineHash: imageHash('3'),
    }),
    snapshotRecord('s2', baselineId, {
      storyId: 'approved',
      state: 'changed',
      review: 'approved',
      imageHash: imageHash('4'),
      baselineHash: imageHash('5'),
    }),
    snapshotRecord('s3', baselineId, {
      storyId: 'denied',
      state: 'changed',
      review: 'denied',
      imageHash: imageHash('6'),
      baselineHash: imageHash('7'),
    }),
    snapshotRecord('s4', baselineId, {
      storyId: 'unreviewed-new',
      state: 'new',
      review: 'pending',
      imageHash: imageHash('8'),
    }),
  ];
}

describe('createBuild with a baseline', () => {
  it('resolves the baseline and returns the accepted image of each of its stories', async () => {
    const { deps, project } = await setup();
    const baselineId = (await createBuild(deps, project, createBuildRequest(sha('b')))).build.id;
    await deps.builds.updateStatus(baselineId, 'accepted', deps.clock.now());
    await deps.builds.saveSnapshots(baselineId, baselineRecords(baselineId));

    const response = await createBuild(
      deps,
      project,
      createBuildRequest(sha('c'), {
        mergeBaseSha: sha('d'),
        ancestors: [sha('b')],
        trigger: 'pr',
      }),
    );

    expect(response.baselineBuildId).toBe(baselineId);
    expect(response.baselines).toEqual([
      { storyId: 'same', variant: 'default', imageHash: imageHash('3') },
      { storyId: 'approved', variant: 'default', imageHash: imageHash('4') },
      { storyId: 'denied', variant: 'default', imageHash: imageHash('7') },
    ]);
    expect(response.build.number).toBe(2);
  });
});

describe('getBuild and listSnapshots', () => {
  it('report an in_progress build as in_progress with no conclusion', async () => {
    const { deps, project } = await setup();
    const { build } = await createBuild(deps, project, createBuildRequest(sha('a')));

    const response = await getBuild(deps, project, build.id);

    expect(GetBuildResponse.parse(response).build.status).toBe('in_progress');
    expect(response.build.checkRunId).toBeNull();
    expect(response.summary).toEqual({
      status: 'in_progress',
      conclusion: null,
      pendingCount: 0,
      deniedCount: 0,
      errorCount: 0,
    });
  });

  it('fold the snapshots of a completed build and list them without storage-only fields', async () => {
    const { deps, project } = await setup();
    const { build } = await createBuild(deps, project, createBuildRequest(sha('a')));
    const record = snapshotRecord('s1', build.id, { blank: true });
    await deps.builds.saveSnapshots(build.id, [record]);
    await deps.builds.updateStatus(build.id, 'pending', deps.clock.now());

    expect((await getBuild(deps, project, build.id)).summary).toMatchObject({
      status: 'pending',
      pendingCount: 1,
    });
    const listed = await listSnapshots(deps, project, build.id);
    expect(ListSnapshotsResponse.parse(listed)).toEqual(listed);
    expect(listed.snapshots[0]).not.toHaveProperty('blank');
    expect(listed.snapshots[0]).not.toHaveProperty('error');
  });

  it('answer not_found for a build of another project', async () => {
    const { deps, project } = await setup();
    const other = await deps.projects.create(newProject('other'));
    const { build } = await createBuild(deps, other, createBuildRequest(sha('a')));

    await expect(getBuild(deps, project, build.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(listSnapshots(deps, project, build.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
