import { z } from 'zod';

import { Build, Platform } from './build.ts';
import { ImageHash } from './snapshot.ts';

/** One story of a project's library: its accepted image on the default branch. */
export const LibraryStory = z.object({
  storyId: z.string().min(1),
  variant: z.string().min(1),
  /** Storybook's component title and story name, when the capture reported them. */
  title: z.string().min(1).nullable(),
  name: z.string().min(1).nullable(),
  imageHash: ImageHash,
});
export type LibraryStory = z.infer<typeof LibraryStory>;

/**
 * `GET /api/projects/:id/library` query. `platform` picks which platform's library to read
 * (ADR 0036); without it, the first of the response's `platforms`.
 */
export const GetLibraryQuery = z.object({
  platform: Platform.optional(),
});
export type GetLibraryQuery = z.infer<typeof GetLibraryQuery>;

/**
 * `GET /api/projects/:id/library` response: every story of the newest signed-off build of one
 * platform on the project's default branch. `platforms` lists every platform that has such a
 * build, in `Platform` order (ios, android, web), and `platform` is the one shown: the query's,
 * else the first of `platforms`, else null. `build` is null, and `stories` empty, until the
 * platform shown has a signed-off build.
 */
export const GetLibraryResponse = z.object({
  platform: Platform.nullable(),
  platforms: z.array(Platform),
  build: Build.nullable(),
  stories: z.array(LibraryStory),
});
export type GetLibraryResponse = z.infer<typeof GetLibraryResponse>;
