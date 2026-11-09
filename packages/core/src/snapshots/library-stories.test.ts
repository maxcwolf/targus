import { describe, expect, it } from 'vitest';

import { GetLibraryResponse } from '../contracts/library.ts';
import type { Snapshot } from '../contracts/snapshot.ts';
import { libraryStories } from './library-stories.ts';

const current = 'b'.repeat(64);
const baseline = 'a'.repeat(64);

function snapshot(fields: Partial<Snapshot> & Pick<Snapshot, 'storyId' | 'state'>): Snapshot {
  return {
    id: `snap-${fields.storyId}`,
    buildId: 'build-1',
    variant: 'default',
    title: 'Button',
    name: 'Primary',
    imageHash: current,
    width: 10,
    height: 20,
    baselineHash: baseline,
    diffHash: null,
    diffRatio: null,
    review: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    ...fields,
  };
}

describe('libraryStories', () => {
  it('lists every remaining story with its accepted image, in the order given', () => {
    const stories = libraryStories([
      snapshot({ storyId: 'a--same', state: 'unchanged' }),
      snapshot({ storyId: 'b--approved', state: 'changed', variant: 'dark' }),
      snapshot({ storyId: 'c--denied', state: 'changed', review: 'denied' }),
      snapshot({ storyId: 'd--broken', state: 'error', imageHash: null, review: 'pending' }),
    ]);

    expect(stories).toEqual([
      {
        storyId: 'a--same',
        variant: 'default',
        title: 'Button',
        name: 'Primary',
        imageHash: current,
      },
      {
        storyId: 'b--approved',
        variant: 'dark',
        title: 'Button',
        name: 'Primary',
        imageHash: current,
      },
      {
        storyId: 'c--denied',
        variant: 'default',
        title: 'Button',
        name: 'Primary',
        imageHash: baseline,
      },
      {
        storyId: 'd--broken',
        variant: 'default',
        title: 'Button',
        name: 'Primary',
        imageHash: baseline,
      },
    ]);
    const response = { platform: null, platforms: [], build: null, stories };
    expect(GetLibraryResponse.parse(response)).toEqual(response);
  });

  it('leaves out removed stories and stories without an accepted image', () => {
    const stories = libraryStories([
      snapshot({ storyId: 'gone', state: 'removed', imageHash: null, title: null, name: null }),
      snapshot({ storyId: 'unapproved', state: 'new', baselineHash: null, review: 'pending' }),
      snapshot({ storyId: 'never-rendered', state: 'error', imageHash: null, baselineHash: null }),
    ]);

    expect(stories).toEqual([]);
  });
});

describe('libraryStories for an unstable story', () => {
  it('shows the kept baseline, not the capture nobody reviewed (ADR 0030)', () => {
    const stories = libraryStories([snapshot({ storyId: 'spinner', state: 'unstable' })]);

    expect(stories).toMatchObject([{ storyId: 'spinner', imageHash: baseline }]);
  });
});
