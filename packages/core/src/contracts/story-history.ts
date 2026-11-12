import { z } from 'zod';

import { Build, Platform } from './build.ts';
import { Snapshot } from './snapshot.ts';

/** How many entries a story history request returns when it names no `limit`. */
export const defaultStoryHistoryLimit = 20;
/** The largest `limit` a story history request may ask for. */
export const maxStoryHistoryLimit = 50;

/**
 * `GET /api/projects/:id/history` query: one story of one platform, by its id and variant
 * (`default` when absent). Baselines are per platform (ADR 0036), so a history is too.
 */
export const GetStoryHistoryQuery = z.object({
  storyId: z.string().min(1),
  variant: z.string().min(1).default('default'),
  platform: Platform,
  limit: z.coerce.number().int().min(1).max(maxStoryHistoryLimit).default(defaultStoryHistoryLimit),
});
export type GetStoryHistoryQuery = z.infer<typeof GetStoryHistoryQuery>;

/** One event in a story's history: its snapshot in a build, and that build. */
export const StoryHistoryEntry = z.object({
  build: Build,
  snapshot: Snapshot,
});
export type StoryHistoryEntry = z.infer<typeof StoryHistoryEntry>;

/**
 * `GET /api/projects/:id/history` response: the builds in which the story was anything but
 * `unchanged` (first captured, changed, removed, unstable or errored), on any branch, newest
 * build first.
 */
export const GetStoryHistoryResponse = z.object({
  entries: z.array(StoryHistoryEntry),
});
export type GetStoryHistoryResponse = z.infer<typeof GetStoryHistoryResponse>;
