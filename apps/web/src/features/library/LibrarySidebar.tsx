import { Link } from '@tanstack/react-router';
import type { LibraryStory } from '@targus/core';
import { type ReactElement, useEffect, useRef } from 'react';

import { PathText } from '../../components/PathText.js';
import { storyName } from '../build/filters.js';
import { groupStories, storyKey } from './stories.js';

export interface LibrarySidebarProps {
  readonly projectId: string;
  /** The stories matching the search, in library order. */
  readonly stories: readonly LibraryStory[];
  readonly currentKey: string | undefined;
  readonly query: string;
  readonly onQuery: (query: string) => void;
}

function StoryLink(props: {
  readonly projectId: string;
  /** The story to open; undefined is the "All stories" overview. */
  readonly story: LibraryStory | undefined;
  readonly current: boolean;
}): ReactElement {
  const { projectId, story, current } = props;
  return (
    <Link
      to="/projects/$projectId/library"
      params={{ projectId }}
      search={story ? { story: storyKey(story) } : {}}
      className={current ? 'sidebar-link current' : 'sidebar-link'}
      aria-current={current ? 'page' : undefined}
    >
      <span className="sidebar-name">{story ? storyName(story) : 'All stories'}</span>
    </Link>
  );
}

/** Storybook's sidebar: a search box, then every component with its stories under it. */
export function LibrarySidebar(props: LibrarySidebarProps): ReactElement {
  const { projectId, stories, currentKey, query, onQuery } = props;
  const currentRow = useRef<HTMLLIElement>(null);
  useEffect(() => {
    currentRow.current?.scrollIntoView({ block: 'nearest' });
  }, [currentKey]);
  return (
    <nav className="sidebar" aria-label="Library stories">
      <div className="sidebar-search">
        <input
          type="search"
          value={query}
          placeholder="Find stories"
          aria-label="Find stories"
          onChange={(event) => {
            onQuery(event.target.value);
          }}
        />
      </div>
      <StoryLink projectId={projectId} story={undefined} current={currentKey === undefined} />
      {groupStories(stories).map((group) => (
        <section key={group.title} className="sidebar-group">
          <h2>
            <PathText text={group.title} />
          </h2>
          <ul>
            {group.stories.map((story) => {
              const current = storyKey(story) === currentKey;
              return (
                <li key={storyKey(story)} ref={current ? currentRow : undefined}>
                  <StoryLink projectId={projectId} story={story} current={current} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
