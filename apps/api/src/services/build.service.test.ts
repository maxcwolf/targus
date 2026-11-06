import {
  CreateBuildResponse,
  emptyTally,
  GetBuildResponse,
  ListBuildsResponse,
  ListSnapshotsResponse,
  tallySnapshots,
} from '@targus/core';
import { describe, expect, it } from 'vitest';

import {
  captured,
  createBuildRequest,
  imageHash,
  newProject,
  sha,
  snapshotRecord,
} from '../../test/support/fixtures.ts';
import { createRecordingGitHub } from '../../test/support/github-recorder.ts';
import { signInReviewer } from '../../test/support/in-memory-auth.ts';
import {
  asProject,
  completion,
  createTestDeps,
  type TestDeps,
} from '../../test/support/in-memory.ts';
import type { SnapshotRecord } from '../repositories/build.repository.ts';
import type { Project } from '../repositories/project.repository.ts';
import { createBuild, getBuild, listBuilds, listSnapshots } from './build.service.ts';

async function setup(): Promise<{ deps: TestDeps; project: Project }> {
  const deps = createTestDeps();
  return { deps, project: await deps.projects.create(newProject('svc')) };
}

describe('createBuild', () => {
  it('opens an in_progress build without a baseline and lists the images this project has not uploaded', async () => {
    const { deps, project } = await setup();
    for (const hash of [imageHash('1'), imageHash('2')]) {
      await deps.images.record({ hash, sizeBytes: 1, width: 1, height: 1 }, deps.clock.now());
    }
    await deps.images.recordUpload(project.id, imageHash('1'), deps.clock.now());
    await deps.images.recordUpload('project-other', imageHash('2'), deps.clock.now());
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
    await deps.builds.completeWithResults(
      baselineId,
      baselineRecords(baselineId),
      completion('accepted', deps.clock.now()),
    );

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

    const response = await getBuild(deps, asProject(project), build.id);

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
    await deps.builds.completeWithResults(build.id, [record], {
      ...completion('pending', deps.clock.now()),
      tally: tallySnapshots([record]),
    });

    expect((await getBuild(deps, asProject(project), build.id)).summary).toMatchObject({
      status: 'pending',
      pendingCount: 1,
    });
    const listed = await listSnapshots(deps, asProject(project), build.id);
    expect(ListSnapshotsResponse.parse(listed)).toEqual(listed);
    expect(listed.snapshots[0]).not.toHaveProperty('blank');
    expect(listed.snapshots[0]).not.toHaveProperty('error');
  });

  it('answer not_found for a build of another project', async () => {
    const { deps, project } = await setup();
    const other = await deps.projects.create(newProject('other'));
    const { build } = await createBuild(deps, other, createBuildRequest(sha('a')));

    await expect(getBuild(deps, asProject(project), build.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(listSnapshots(deps, asProject(project), build.id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

async function reviewSetup() {
  const deps = createTestDeps({ github: createRecordingGitHub(['octocat']) });
  const project = await deps.projects.create(newProject('rev', { installationId: 42 }));
  const member = await signInReviewer(deps, 'octocat');
  const outsider = await signInReviewer(deps, 'outsider');
  return { deps, project, member, outsider };
}

describe('build reads for reviewers', () => {
  it('lets a member read a build and its snapshots, and forbids an outsider', async () => {
    const { deps, project, member, outsider } = await reviewSetup();
    const { build } = await createBuild(deps, project, createBuildRequest(sha('a')));

    const read = await getBuild(deps, { kind: 'reviewer', reviewer: member }, build.id);

    expect(read.build).not.toHaveProperty('tally');
    expect(read.counts).toEqual(emptyTally.counts);
    expect(
      (await listSnapshots(deps, { kind: 'reviewer', reviewer: member }, build.id)).snapshots,
    ).toEqual([]);
    await expect(
      getBuild(deps, { kind: 'reviewer', reviewer: outsider }, build.id),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lists builds newest first with status and counts from the stored tally', async () => {
    const { deps, project, member } = await reviewSetup();
    const first = (await createBuild(deps, project, createBuildRequest(sha('a')))).build;
    await createBuild(deps, project, createBuildRequest(sha('b')));
    const tally = { ...emptyTally, counts: { ...emptyTally.counts, changed: 2 }, pendingCount: 2 };
    await deps.builds.completeWithResults(first.id, [], {
      ...completion('pending', deps.clock.now()),
      tally,
    });

    const response = await listBuilds(deps, member, project.id);

    expect(ListBuildsResponse.parse(response)).toEqual(response);
    expect(response.builds.map((entry) => entry.build.number)).toEqual([2, 1]);
    expect(response.builds[1]).toMatchObject({
      summary: { status: 'pending', pendingCount: 2 },
      counts: { changed: 2 },
    });
    expect(response.nextCursor).toBeNull();
  });
});

describe('listBuilds paging', () => {
  it('pages to the oldest build with the next cursor and rejects a forged one', async () => {
    const { deps, project, member } = await reviewSetup();
    for (const letter of ['a', 'b', 'c']) {
      await createBuild(deps, project, createBuildRequest(sha(letter)));
    }

    const first = await listBuilds(deps, member, project.id, { limit: 2 });
    const last = await listBuilds(deps, member, project.id, {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });

    expect(first.builds.map((entry) => entry.build.number)).toEqual([3, 2]);
    expect(last).toMatchObject({ builds: [{ build: { number: 1 } }], nextCursor: null });
    await expect(listBuilds(deps, member, project.id, { cursor: 'forged' })).rejects.toMatchObject({
      code: 'bad_request',
    });
  });

  it('answers not_found for an unknown project and forbidden outside the org', async () => {
    const { deps, project, member, outsider } = await reviewSetup();

    await expect(listBuilds(deps, member, 'nope')).rejects.toMatchObject({ code: 'not_found' });
    await expect(listBuilds(deps, outsider, project.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
