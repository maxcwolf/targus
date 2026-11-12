import { describe, expect, it } from 'vitest';

import type { SnapshotRecord, StoryRef } from '../../../src/ports/build-repository.ts';
import { newBuild, snapshotRecord } from '../fixtures.ts';
import { completionOf, type BuildHarness } from './build-harness.ts';
import type { NewBuild } from '@targus/core';

const button: StoryRef = { storyId: 'button--primary', variant: 'default', platform: 'ios' };

/** A completed build of `projectId` holding `snapshots` (ids prefixed with the build's). */
async function completedBuild(
  { repository }: BuildHarness,
  projectId: string,
  buildId: string,
  snapshots: readonly Partial<SnapshotRecord>[],
  overrides: Partial<NewBuild> = {},
): Promise<void> {
  await repository.create(newBuild(buildId, projectId, overrides));
  const records = snapshots.map((fields, index) =>
    snapshotRecord(`${buildId}-${String(index)}`, buildId, { storyId: button.storyId, ...fields }),
  );
  await repository.completeWithResults(buildId, records, completionOf(records));
}

type Harness = () => BuildHarness;

function describeOrder(name: string, harness: Harness): void {
  describe(`${name} listStoryHistory order`, () => {
    it('lists the builds where the story was not unchanged, newest first, with each build', async () => {
      const h = harness();
      const projectId = await h.seedProject('history');
      await completedBuild(h, projectId, 'history-1', [{ state: 'new' }]);
      await completedBuild(h, projectId, 'history-2', [{ state: 'unchanged' }]);
      await completedBuild(h, projectId, 'history-3', [{ state: 'changed' }], {
        branch: 'feature/x',
        prNumber: 7,
      });
      await completedBuild(h, projectId, 'history-4', [{ state: 'removed', imageHash: null }]);

      const history = await h.repository.listStoryHistory(projectId, button, 10);

      expect(
        history.map(({ build, snapshot }) => [build.number, build.branch, snapshot.state]),
      ).toEqual([
        [4, 'main', 'removed'],
        [3, 'feature/x', 'changed'],
        [1, 'main', 'new'],
      ]);
      expect(history[1]?.snapshot).toMatchObject({ id: 'history-3-0', buildId: 'history-3' });
      expect(history[1]?.build).toMatchObject({ id: 'history-3', prNumber: 7, projectId });
    });
  });
}

function describeScope(name: string, harness: Harness): void {
  describe(`${name} listStoryHistory scope`, () => {
    it('keeps to the story, its variant, its platform and the project', async () => {
      const h = harness();
      const projectId = await h.seedProject('history-scope');
      const otherProject = await h.seedProject('history-other');
      await completedBuild(h, projectId, 'scope-1', [
        { state: 'new' },
        { state: 'new', variant: 'ax5' },
        { state: 'new', storyId: 'card--default' },
      ]);
      await completedBuild(h, projectId, 'scope-web', [{ state: 'new' }], { platform: 'web' });
      await completedBuild(h, otherProject, 'scope-other', [{ state: 'new' }]);

      const ids = async (story: StoryRef, project = projectId): Promise<string[]> =>
        (await h.repository.listStoryHistory(project, story, 10)).map((entry) => entry.snapshot.id);

      expect(await ids(button)).toEqual(['scope-1-0']);
      expect(await ids({ ...button, variant: 'ax5' })).toEqual(['scope-1-1']);
      expect(await ids({ ...button, platform: 'web' })).toEqual(['scope-web-0']);
      expect(await ids({ ...button, platform: 'android' })).toEqual([]);
      expect(await ids(button, otherProject)).toEqual(['scope-other-0']);
      expect(await ids({ ...button, storyId: 'never-captured' })).toEqual([]);
    });

    it('returns at most the limit, the newest', async () => {
      const h = harness();
      const projectId = await h.seedProject('history-limit');
      for (const key of ['a', 'b', 'c']) {
        await completedBuild(h, projectId, `limit-${key}`, [{ state: 'changed' }]);
      }

      const history = await h.repository.listStoryHistory(projectId, button, 2);

      expect(history.map((entry) => entry.build.number)).toEqual([3, 2]);
    });
  });
}

/**
 * `listStoryHistory`, run against every storage adapter and the in-memory double so the double
 * cannot drift from what the databases do.
 */
export function describeBuildHistory(name: string, harness: Harness): void {
  describeOrder(name, harness);
  describeScope(name, harness);
}
