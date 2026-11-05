import { z } from 'zod';

import { Build } from './build.js';
import { ImageHash, Snapshot } from './snapshot.js';

/**
 * The fold of a build's snapshots, as `buildStatus` computes it, in wire form. `in_progress`
 * while the build has no results yet: nothing to fold, so every count is 0 and there is no
 * conclusion.
 */
export const BuildStatusSummary = z.object({
  status: z.enum(['in_progress', 'pending', 'accepted', 'denied', 'passed', 'failed']),
  conclusion: z.enum(['success', 'failure']).nullable(),
  pendingCount: z.number().int().nonnegative(),
  deniedCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
});
export type BuildStatusSummary = z.infer<typeof BuildStatusSummary>;

/** `GET /api/builds/:id` response. */
export const GetBuildResponse = z.object({
  build: Build,
  summary: BuildStatusSummary,
});
export type GetBuildResponse = z.infer<typeof GetBuildResponse>;

/** `GET /api/builds/:id/snapshots` response. */
export const ListSnapshotsResponse = z.object({
  snapshots: z.array(Snapshot),
});
export type ListSnapshotsResponse = z.infer<typeof ListSnapshotsResponse>;

/**
 * `POST /api/builds/:id/results` response: the build's new status and where to review it.
 * `checkRun` is null when the project has no GitHub App installation.
 */
export const SubmitResultsResponse = z.object({
  build: z.object({ id: z.string().min(1), number: z.number().int().positive() }),
  summary: BuildStatusSummary,
  reviewUrl: z.url(),
  checkRun: z.object({ id: z.number().int().positive() }).nullable(),
});
export type SubmitResultsResponse = z.infer<typeof SubmitResultsResponse>;

/** `PUT /api/images/:hash` response. `stored` is false when the hash already existed. */
export const UploadImageResponse = z.object({
  hash: ImageHash,
  stored: z.boolean(),
});
export type UploadImageResponse = z.infer<typeof UploadImageResponse>;
