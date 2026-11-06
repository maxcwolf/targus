import type { LibraryStory } from '@targus/core';

import { componentTitle, storyName } from '../build/filters.js';

/** The `?story=` search param of the library route. */
export interface LibrarySearch {
  readonly story?: string;
}

/** TanStack Router `validateSearch`: anything but a non-empty string is dropped. */
export function validateLibrarySearch(search: Record<string, unknown>): LibrarySearch {
  return typeof search.story === 'string' && search.story !== '' ? { story: search.story } : {};
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
