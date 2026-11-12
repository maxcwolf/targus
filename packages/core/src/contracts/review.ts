import { z } from 'zod';

import { Build } from './build.ts';
import { BuildStatusSummary, SnapshotCounts } from './build-summary.ts';
import { ProjectSummary } from './project.ts';
import { Snapshot } from './snapshot.ts';

/** A reviewer, as GitHub login identified them. */
export const ReviewerUser = z.object({
  id: z.string().min(1),
  githubId: z.number().int().positive(),
  login: z.string().min(1),
  avatarUrl: z.url(),
});
export type ReviewerUser = z.infer<typeof ReviewerUser>;

/** `GET /api/me` response; 401 when there is no session. */
export const MeResponse = z.object({ user: ReviewerUser });
export type MeResponse = z.infer<typeof MeResponse>;

/** `GET /api/projects` response: the projects whose org the reviewer belongs to. */
export const ListProjectsResponse = z.object({ projects: z.array(ProjectSummary) });
export type ListProjectsResponse = z.infer<typeof ListProjectsResponse>;

/** A reviewer's decision on one snapshot. */
export const ReviewDecision = z.enum(['approve', 'deny']);
export type ReviewDecision = z.infer<typeof ReviewDecision>;

/** `POST /api/snapshots/:id/review` request body. */
export const ReviewRequest = z.object({
  decision: ReviewDecision,
});
export type ReviewRequest = z.infer<typeof ReviewRequest>;

/** `POST /api/snapshots/:id/review` response: the snapshot and its build after the decision. */
export const ReviewSnapshotResponse = z.object({
  snapshot: Snapshot,
  build: Build,
  summary: BuildStatusSummary,
  counts: SnapshotCounts,
});
export type ReviewSnapshotResponse = z.infer<typeof ReviewSnapshotResponse>;

/**
 * `POST /api/builds/:id/approve-all` response. `approvedCount` is how many pending changes this
 * request approved; `skippedCount` is how many were pending when it started but were decided by
 * another review before it committed, and so were left as that review decided them (ADR 0026).
 */
export const ApproveAllResponse = z.object({
  build: Build,
  summary: BuildStatusSummary,
  counts: SnapshotCounts,
  approvedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
});
export type ApproveAllResponse = z.infer<typeof ApproveAllResponse>;

/** The most snapshots one `POST /api/builds/:id/review` may decide. */
export const maxReviewSnapshots = 500;

/**
 * `POST /api/builds/:id/review` request body: one decision on several snapshots of the build,
 * such as every unreviewed story of a component.
 */
export const ReviewSnapshotsRequest = z.object({
  decision: ReviewDecision,
  snapshotIds: z.array(z.string().min(1)).min(1).max(maxReviewSnapshots),
});
export type ReviewSnapshotsRequest = z.infer<typeof ReviewSnapshotsRequest>;

/**
 * `POST /api/builds/:id/review` response: the build after the decision. `decidedCount` is how
 * many of the snapshots it changed; one already decided that way is left as it was and not
 * counted.
 */
export const ReviewSnapshotsResponse = z.object({
  build: Build,
  summary: BuildStatusSummary,
  counts: SnapshotCounts,
  decidedCount: z.number().int().nonnegative(),
});
export type ReviewSnapshotsResponse = z.infer<typeof ReviewSnapshotsResponse>;
