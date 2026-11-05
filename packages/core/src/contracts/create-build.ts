import { z } from 'zod';

import { BuildTrigger, GitSha } from './build.js';
import { ImageHash } from './snapshot.js';

/** One captured story the CLI reports when it opens a build. */
export const CapturedSnapshot = z.object({
  storyId: z.string().min(1),
  variant: z.string().min(1).default('default'),
  imageHash: ImageHash,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type CapturedSnapshot = z.infer<typeof CapturedSnapshot>;

/**
 * `POST /api/builds` request body (plan.md section 5.2). Authenticated by project token.
 * `ancestors` is the first-parent ancestor list of the merge base, nearest first, so the server
 * can pick the nearest ancestor that has a build (plan.md section 6, rule 1).
 */
export const CreateBuildRequest = z.object({
  sha: GitSha,
  branch: z.string().min(1),
  prNumber: z.number().int().positive().nullable(),
  mergeBaseSha: GitSha.nullable(),
  ancestors: z.array(GitSha).max(100),
  trigger: BuildTrigger,
  device: z.string().min(1),
  snapshots: z.array(CapturedSnapshot),
});
export type CreateBuildRequest = z.infer<typeof CreateBuildRequest>;

/** The accepted image for one story in the baseline build. */
export const BaselineEntry = z.object({
  storyId: z.string().min(1),
  variant: z.string().min(1),
  imageHash: ImageHash,
});
export type BaselineEntry = z.infer<typeof BaselineEntry>;

/**
 * `POST /api/builds` response: the new build, its baseline build and per-story baseline hashes,
 * and the image hashes the server does not have yet (the CLI uploads only those).
 */
export const CreateBuildResponse = z.object({
  build: z.object({
    id: z.string().min(1),
    number: z.number().int().positive(),
  }),
  baselineBuildId: z.string().min(1).nullable(),
  baselines: z.array(BaselineEntry),
  missingImageHashes: z.array(ImageHash),
});
export type CreateBuildResponse = z.infer<typeof CreateBuildResponse>;
