import { GetLibraryResponse, type Platform } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { imageHash, newBuild, newProject, snapshotRecord } from '../../test/support/fixtures.ts';
import { createRecordingGitHub } from '../../test/support/github-recorder.ts';
import { signInReviewer } from '../../test/support/in-memory-auth.ts';
import { createTestDeps } from '../../test/support/in-memory.ts';
import { getLibrary } from './library.service.ts';

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

    expect(await getLibrary(deps, member, project.id)).toEqual({
      platform: null,
      platforms: [],
      build: null,
      stories: [],
    });
  });

  it('lists the stories of the newest signed-off build on the default branch', async () => {
    const { deps, project, member } = await setup();
    await deps.builds.create(newBuild('old', project.id, { status: 'passed' }));
    await deps.builds.create(newBuild('latest', project.id, { status: 'accepted' }));
    await deps.builds.create(newBuild('unreviewed', project.id, { status: 'pending' }));
    // Seeded directly: these builds were created already signed off.
    deps.builds.snapshots.set('old', [snapshotRecord('o1', 'old')]);
    deps.builds.snapshots.set('latest', [
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
    expect([response.platform, response.platforms]).toEqual(['ios', ['ios']]);
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
});

describe('getLibrary platforms and access', () => {
  it('reads one platform: the one asked for, else the first in ios, android, web order', async () => {
    const { deps, project, member } = await setup();
    const signedOff = (id: string, platform: Platform) =>
      deps.builds.create(newBuild(id, project.id, { status: 'passed', platform }));
    await signedOff('web-1', 'web');
    await signedOff('android-1', 'android');
    await deps.builds.create(newBuild('ios-pending', project.id, { status: 'pending' }));
    const read = (platform?: Platform) =>
      getLibrary(deps, member, project.id, platform === undefined ? {} : { platform });

    expect(await read()).toMatchObject({
      platform: 'android',
      platforms: ['android', 'web'],
      build: { id: 'android-1', platform: 'android' },
    });
    expect(await read('web')).toMatchObject({ platform: 'web', build: { id: 'web-1' } });
    expect(await read('ios')).toEqual({
      platform: 'ios',
      platforms: ['android', 'web'],
      build: null,
      stories: [],
    });
  });

  it('answers not_found for an unknown project and forbidden outside the org', async () => {
    const { deps, project, member, outsider } = await setup();

    await expect(getLibrary(deps, member, 'nope')).rejects.toMatchObject({ code: 'not_found' });
    await expect(getLibrary(deps, outsider, project.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
