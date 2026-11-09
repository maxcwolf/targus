import { Link } from '@tanstack/react-router';
import type { LibraryStory, Platform } from '@targus/core/browser';
import type { ReactElement } from 'react';

import { imageUrl } from '../../api-client/index.ts';
import { PathText } from '../../components/PathText.tsx';
import { SnapshotImage } from '../../components/SnapshotImage.tsx';
import { storyName } from '../build/index.ts';
import { groupStories, librarySearch, storyKey, storyTitle } from './stories.ts';

export interface StoryGridProps {
  readonly projectId: string;
  /** The `?platform=` the library was opened with, kept by every link. */
  readonly platform: Platform | undefined;
  /** The stories matching the search, in library order. */
  readonly stories: readonly LibraryStory[];
}

function StoryCard({
  projectId,
  platform,
  story,
}: {
  readonly projectId: string;
  readonly platform: Platform | undefined;
  readonly story: LibraryStory;
}): ReactElement {
  return (
    <li>
      <Link
        to="/projects/$projectId/library"
        params={{ projectId }}
        search={librarySearch(platform, storyKey(story))}
        className="story-card"
        aria-label={storyTitle(story)}
      >
        <span className="story-thumb">
          <SnapshotImage src={imageUrl(story.imageHash)} alt="" />
        </span>
        <span className="story-card-name">{storyName(story)}</span>
      </Link>
    </li>
  );
}

/** Every story as a thumbnail, under its component: the library's overview. */
export function StoryGrid({ projectId, platform, stories }: StoryGridProps): ReactElement {
  if (stories.length === 0) {
    return (
      <div className="empty-state">
        <p>No stories match your search</p>
      </div>
    );
  }
  return (
    <>
      {groupStories(stories).map((group) => (
        <section key={group.title} className="library-group" aria-label={group.title}>
          <h2 className="library-group-title">
            <PathText text={group.title} />
            <span className="lighter"> · {group.stories.length}</span>
          </h2>
          <ul className="story-grid">
            {group.stories.map((story) => (
              <StoryCard
                key={storyKey(story)}
                projectId={projectId}
                platform={platform}
                story={story}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
