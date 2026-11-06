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

const count = z.number().int().nonnegative();

/** How many of a build's snapshots are in each state, for the builds list (plan.md 5.3). */
export const SnapshotCounts = z.object({
  unchanged: count,
  changed: count,
  new: count,
  removed: count,
  unstable: count,
  error: count,
});
export type SnapshotCounts = z.infer<typeof SnapshotCounts>;

/** A build with its derived status and counts: one row of the builds list. */
export const BuildWithSummary = z.object({
  build: Build,
  summary: BuildStatusSummary,
  counts: SnapshotCounts,
});
export type BuildWithSummary = z.infer<typeof BuildWithSummary>;

/** `GET /api/builds/:id` response: one `BuildWithSummary` (its own schema object, so knip sees
 * two exports rather than one value under two names). */
export const GetBuildResponse = z.object({ ...BuildWithSummary.shape });
export type GetBuildResponse = z.infer<typeof GetBuildResponse>;

/** How many builds one page of the builds list holds when the request names no `limit`. */
export const defaultBuildsPageLimit = 50;
/** The largest `limit` a builds list request may ask for. */
export const maxBuildsPageLimit = 100;

/**
 * `GET /api/projects/:id/builds` query. Both are optional: with neither, the newest
 * `defaultBuildsPageLimit` builds. `cursor` is opaque; send back a page's `nextCursor`.
 */
export const ListBuildsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(maxBuildsPageLimit).optional(),
  cursor: z.string().min(1).max(128).optional(),
});
export type ListBuildsQuery = z.infer<typeof ListBuildsQuery>;

/**
 * `GET /api/projects/:id/builds` response, newest build first. `nextCursor` reads the next,
 * older page; null on the last page. It defaults to null so a body without it still parses.
 */
export const ListBuildsResponse = z.object({
  builds: z.array(BuildWithSummary),
  nextCursor: z.string().min(1).nullable().default(null),
});
export type ListBuildsResponse = z.infer<typeof ListBuildsResponse>;

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
