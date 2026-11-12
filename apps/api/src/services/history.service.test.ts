import { GetStoryHistoryQuery, GetStoryHistoryResponse } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { newBuild, newProject, snapshotRecord } from '../../test/support/fixtures.ts';
import { createRecordingGitHub } from '../../test/support/github-recorder.ts';
import { signInReviewer } from '../../test/support/in-memory-auth.ts';
import { createTestDeps } from '../../test/support/in-memory.ts';
import { getStoryHistory } from './history.service.ts';

const query = (fields: Record<string, string> = {}): GetStoryHistoryQuery =>
  GetStoryHistoryQuery.parse({ storyId: 'button--primary', platform: 'ios', ...fields });

async function setup() {
  const deps = createTestDeps({ github: createRecordingGitHub(['octocat']) });
  const project = await deps.projects.create(newProject('hist', { installationId: 42 }));
  const member = await signInReviewer(deps, 'octocat');
  const outsider = await signInReviewer(deps, 'outsider');
  for (const [id, state] of [
    ['first', 'new'],
    ['second', 'unchanged'],
    ['third', 'changed'],
  ] as const) {
    await deps.builds.create(newBuild(id, project.id, { status: 'accepted' }));
    // Seeded directly: these builds were created already signed off.
    deps.builds.snapshots.set(id, [
      snapshotRecord(`${id}-s`, id, { storyId: 'button--primary', state, review: 'approved' }),
    ]);
  }
  return { deps, project, member, outsider };
}

describe('getStoryHistory', () => {
  it('returns the story’s changes newest first, in wire form', async () => {
    const { deps, project, member } = await setup();

    const response = await getStoryHistory(deps, member, project.id, query());

    expect(GetStoryHistoryResponse.parse(response)).toEqual(response);
    expect(response.entries.map((entry) => [entry.build.number, entry.snapshot.state])).toEqual([
      [3, 'changed'],
      [1, 'new'],
    ]);
    expect(response.entries[0]?.build).not.toHaveProperty('tally');
    expect(response.entries[0]?.snapshot).not.toHaveProperty('error');
  });

  it('honours the limit, and is empty for a story never captured', async () => {
    const { deps, project, member } = await setup();

    const one = await getStoryHistory(deps, member, project.id, query({ limit: '1' }));
    const none = await getStoryHistory(deps, member, project.id, query({ storyId: 'nope' }));

    expect(one.entries.map((entry) => entry.build.number)).toEqual([3]);
    expect(none).toEqual({ entries: [] });
  });

  it('is not found for an unknown project and forbidden to a non-member', async () => {
    const { deps, project, member, outsider } = await setup();

    await expect(getStoryHistory(deps, member, 'nope', query())).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(getStoryHistory(deps, outsider, project.id, query())).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
