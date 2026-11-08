import { describe, expect, it } from 'vitest';

import {
  captured,
  createBuildRequest,
  imageHash,
  newProject,
  sha,
} from '../../test/support/fixtures.ts';
import { completion, createTestDeps, type TestDeps } from '../../test/support/in-memory.ts';
import type { Project } from '../repositories/project.repository.ts';
import { createBuild } from './build.service.ts';

// A repeated `POST /api/builds` under one idempotency key (ADR 0027).

async function setup(): Promise<{ deps: TestDeps; project: Project }> {
  const deps = createTestDeps();
  return { deps, project: await deps.projects.create(newProject('idem')) };
}

describe('createBuild with an idempotency key', () => {
  it('returns the build the key opened, with its baseline and the images still missing', async () => {
    const { deps, project } = await setup();
    const baselineId = (await createBuild(deps, project, createBuildRequest(sha('b')))).build.id;
    await deps.builds.completeWithResults(baselineId, [], completion('passed', deps.clock.now()));
    const request = createBuildRequest(sha('c'), {
      mergeBaseSha: sha('b'),
      snapshots: [captured('button', imageHash('1'))],
      idempotencyKey: 'run-1',
    });

    const first = await createBuild(deps, project, request);
    // A newer baseline and the upload happen before the retry arrives.
    const newer = (await createBuild(deps, project, createBuildRequest(sha('b')))).build.id;
    await deps.builds.completeWithResults(newer, [], completion('passed', deps.clock.now()));
    await deps.images.record(
      { hash: imageHash('1'), sizeBytes: 1, width: 1, height: 1 },
      deps.clock.now(),
    );
    await deps.images.recordUpload(project.id, imageHash('1'), deps.clock.now());
    const again = await createBuild(deps, project, request);

    expect(first).toMatchObject({ build: { number: 2 }, baselineBuildId: baselineId });
    expect(first.missingImageHashes).toEqual([imageHash('1')]);
    expect(again).toEqual({ ...first, missingImageHashes: [] });
    expect(deps.builds.builds.map((build) => build.number)).toEqual([1, 2, 3]);
  });

  it('answers conflict, opening nothing, when the key comes back with another build', async () => {
    const { deps, project } = await setup();
    const request = createBuildRequest(sha('a'), { idempotencyKey: 'run-1' });
    const { build } = await createBuild(deps, project, request);

    await expect(
      createBuild(deps, project, { ...request, branch: 'feature', device: 'iPad' }),
    ).rejects.toMatchObject({
      code: 'conflict',
      message: `this idempotency key already opened build ${build.id} with another branch, device: send a new key for a new build`,
    });
    expect(deps.builds.builds).toHaveLength(1);
  });

  it('opens a build per project under the same key, and one per request without a key', async () => {
    const { deps, project } = await setup();
    const other = await deps.projects.create(newProject('idem-other'));
    const keyed = createBuildRequest(sha('a'), { idempotencyKey: 'run-1' });

    const ours = await createBuild(deps, project, keyed);
    const theirs = await createBuild(deps, other, keyed);
    const unkeyed = createBuildRequest(sha('a'));
    await createBuild(deps, project, unkeyed);
    await createBuild(deps, project, unkeyed);

    expect(theirs.build.id).not.toBe(ours.build.id);
    expect(deps.builds.builds).toHaveLength(4);
  });
});

describe('createBuild with an idempotency key and an appearance', () => {
  it('answers conflict when the key comes back captured in another appearance', async () => {
    const { deps, project } = await setup();
    const request = createBuildRequest(sha('a'), { idempotencyKey: 'run-1' });
    await createBuild(deps, project, request);

    const replay = createBuild(deps, project, { ...request, appearance: 'dark' });

    await expect(replay).rejects.toMatchObject({ code: 'conflict' });
    await expect(replay).rejects.toThrow('with another appearance:');
    expect(deps.builds.builds).toHaveLength(1);
  });
});
