import { GetLibraryResponse } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { imageHash, newBuild, newProject, snapshotRecord } from '../../test/support/fixtures.js';
import { createRecordingGitHub } from '../../test/support/github-recorder.js';
import { signInReviewer } from '../../test/support/in-memory-auth.js';
import { createTestDeps } from '../../test/support/in-memory.js';
import { getLibrary } from './library.service.js';

async function setup() {
  const deps = createTestDeps({ github: createRecordingGitHub(['octocat']) });
  const project = await deps.projects.create(newProject('lib', { installationId: 42 }));
  const member = await signInReviewer(deps, 'octocat');
  const outsider = await signInReviewer(deps, 'outsider');
  return { deps, project, member, outsider };
}

describe('getLibrary', () => {
  it('is empty until a default-branch build has been signed off', async () => {
    const { deps, project, member } = await setup();
    await deps.builds.create(newBuild('pending', project.id, { status: 'pending' }));
    await deps.builds.create(
      newBuild('pr', project.id, { status: 'accepted', branch: 'feature/x', prNumber: 3 }),
    );

    expect(await getLibrary(deps, member, project.id)).toEqual({ build: null, stories: [] });
  });

  it('lists the stories of the newest signed-off build on the default branch', async () => {
    const { deps, project, member } = await setup();
    await deps.builds.create(newBuild('old', project.id, { status: 'passed' }));
    await deps.builds.create(newBuild('latest', project.id, { status: 'accepted' }));
    await deps.builds.create(newBuild('unreviewed', project.id, { status: 'pending' }));
    await deps.builds.saveSnapshots('old', [snapshotRecord('o1', 'old')]);
    await deps.builds.saveSnapshots('latest', [
      snapshotRecord('l1', 'latest', {
        storyId: 'button--primary',
        title: 'Button',
        name: 'Primary',
        state: 'changed',
        review: 'approved',
        imageHash: imageHash('2'),
        baselineHash: imageHash('1'),
      }),
      snapshotRecord('l2', 'latest', { storyId: 'gone', state: 'removed', review: 'approved' }),
    ]);

    const response = await getLibrary(deps, member, project.id);

    expect(GetLibraryResponse.parse(response)).toEqual(response);
    expect(response.build).toMatchObject({ id: 'latest', number: 2, status: 'accepted' });
    expect(response.build).not.toHaveProperty('tally');
    expect(response.stories).toEqual([
      {
        storyId: 'button--primary',
        variant: 'default',
        title: 'Button',
        name: 'Primary',
        imageHash: imageHash('2'),
      },
    ]);
  });

  it('answers not_found for an unknown project and forbidden outside the org', async () => {
    const { deps, project, member, outsider } = await setup();

    await expect(getLibrary(deps, member, 'nope')).rejects.toMatchObject({ code: 'not_found' });
    await expect(getLibrary(deps, outsider, project.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
