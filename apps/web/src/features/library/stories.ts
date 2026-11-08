import { Platform, type LibraryStory } from '@targus/core/browser';

import { componentTitle, storyName } from '../build/index.ts';

/** The `?story=` and `?platform=` search params of the library route. */
export interface LibrarySearch {
  readonly story?: string;
  /** The platform to show; without it, the first that has a library (ADR 0036). */
  readonly platform?: Platform;
}

/**
 * TanStack Router `validateSearch`: a story that is not a non-empty string, and a platform that
 * is not a `Platform`, are dropped.
 */
export function validateLibrarySearch(search: Record<string, unknown>): LibrarySearch {
  const platform = Platform.safeParse(search.platform);
  return librarySearch(
    platform.success ? platform.data : undefined,
    typeof search.story === 'string' && search.story !== '' ? search.story : undefined,
  );
}

/** The library search for a story key (undefined: every story) on a platform (or the default). */
export function librarySearch(
  platform: Platform | undefined,
  story: string | undefined,
): LibrarySearch {
  return {
    ...(story === undefined ? {} : { story }),
    ...(platform === undefined ? {} : { platform }),
  };
}

/** What `?story=` holds: the story id, plus the variant when it is not the default one. */
export function storyKey(story: Pick<LibraryStory, 'storyId' | 'variant'>): string {
  return story.variant === 'default' ? story.storyId : `${story.storyId}~${story.variant}`;
}

/** "Button : Primary", with the variant when it is not the default one. */
export function storyTitle(story: LibraryStory): string {
  const label = `${componentTitle(story)} : ${storyName(story)}`;
  return story.variant === 'default' ? label : `${label} (${story.variant})`;
}

/** Case-insensitive match of every word of `query` against the title, name and story id. */
export function matchesQuery(story: LibraryStory, query: string): boolean {
  const haystack = `${componentTitle(story)} ${storyName(story)} ${story.storyId}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

export interface StoryGroup {
  readonly title: string;
  readonly stories: readonly LibraryStory[];
}

/** Groups stories by component title, keeping the order they arrived in. */
export function groupStories(stories: readonly LibraryStory[]): StoryGroup[] {
  const groups = new Map<string, LibraryStory[]>();
  for (const story of stories) {
    const title = componentTitle(story);
    const group = groups.get(title);
    if (group) group.push(story);
    else groups.set(title, [story]);
  }
  return [...groups].map(([title, members]) => ({ title, stories: members }));
}
