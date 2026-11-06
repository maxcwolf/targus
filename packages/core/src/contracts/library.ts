import { z } from 'zod';

import { Build } from './build.ts';
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
 * `GET /api/projects/:id/library` response: every story of the newest signed-off build on the
 * project's default branch. `build` is null, and `stories` empty, until such a build exists.
 */
export const GetLibraryResponse = z.object({
  build: Build.nullable(),
  stories: z.array(LibraryStory),
});
export type GetLibraryResponse = z.infer<typeof GetLibraryResponse>;
