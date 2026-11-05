import {
  buildStatusFromTally,
  needsReview,
  tallySnapshots,
  TargusError,
  type ApproveAllResponse,
  type ReviewDecision,
  type ReviewSnapshotResponse,
  type ReviewState,
} from '@targus/core';

import type { BuildRecord, SnapshotRecord } from '../repositories/build.repository.js';
import type { Project } from '../repositories/project.repository.js';
import { requireBuildAccess } from './access.service.js';
import { toSnapshot, withSummary } from './build.service.js';
import { syncCheckRun } from './check-run.js';
import type { ServiceDeps } from './deps.js';
import type { Reviewer } from './principal.js';

type ReviewDeps = Pick<
  ServiceDeps,
  'approvals' | 'builds' | 'clock' | 'github' | 'ids' | 'memberships' | 'projects'
>;

/** A build the reviewer may review: readable, and no longer waiting on its results. */
async function requireReviewableBuild(
  deps: ReviewDeps,
  reviewer: Reviewer,
  buildId: string,
): Promise<{ build: BuildRecord; project: Project }> {
  const access = await requireBuildAccess(deps, { kind: 'reviewer', reviewer }, buildId);
  if (access.build.status === 'in_progress') {
    throw new TargusError('conflict', `build ${buildId} has no results yet`);
  }
  return access;
}

/** The approval pair of a reviewable snapshot (plan.md section 6, rule 3). */
function pairOf(project: Project, snapshot: SnapshotRecord) {
  if (snapshot.imageHash === null) {
    throw new TargusError('conflict', 'only changed and new snapshots are reviewable');
  }
  return [
    project.id,
    snapshot.storyId,
    snapshot.variant,
    snapshot.baselineHash,
    snapshot.imageHash,
  ] as const;
}

/** Record the approval of each snapshot's hash pair that the project does not have yet. */
async function recordApprovals(
  deps: ReviewDeps,
  reviewer: Reviewer,
  project: Project,
  snapshots: readonly SnapshotRecord[],
): Promise<void> {
  const approvedAt = deps.clock.now().toISOString();
  for (const snapshot of snapshots) {
    const pair = pairOf(project, snapshot);
    if (await deps.approvals.exists(...pair)) continue;
    const [projectId, storyId, variant, fromHash, toHash] = pair;
    await deps.approvals.create(deps.ids.next(), {
      projectId,
      storyId,
      variant,
      fromHash,
      toHash,
      approvedBy: reviewer.user.login,
      approvedAt,
    });
  }
}

/** Re-fold the build after a decision, store it, and move its check run along. */
async function refreshBuild(
  deps: ReviewDeps,
  project: Project,
  build: BuildRecord,
): Promise<BuildRecord> {
  const tally = tallySnapshots(await deps.builds.listSnapshots(build.id));
  const summary = buildStatusFromTally(tally);
  await deps.builds.updateReview(build.id, { status: summary.status, tally });
  const updated = { ...build, status: summary.status, tally };
  await syncCheckRun(deps, project, updated, summary);
  return updated;
}

/**
 * `POST /api/snapshots/:id/review`. Approving records the hash-pair approval so later builds
 * carry it forward; denying withdraws that pair's approval. Repeating a decision is a no-op.
 */
export async function reviewSnapshot(
  deps: ReviewDeps,
  reviewer: Reviewer,
  snapshotId: string,
  decision: ReviewDecision,
): Promise<ReviewSnapshotResponse> {
  const snapshot = await deps.builds.findSnapshotById(snapshotId);
  if (snapshot === null) throw new TargusError('not_found', `no snapshot ${snapshotId}`);
  const { build, project } = await requireReviewableBuild(deps, reviewer, snapshot.buildId);
  if (!needsReview(snapshot.state)) {
    throw new TargusError('conflict', 'only changed and new snapshots are reviewable');
  }
  const review: ReviewState = decision === 'approve' ? 'approved' : 'denied';
  if (snapshot.review === review) return { snapshot: toSnapshot(snapshot), ...withSummary(build) };

  if (review === 'approved') await recordApprovals(deps, reviewer, project, [snapshot]);
  else await deps.approvals.delete(...pairOf(project, snapshot));
  const reviewedAt = deps.clock.now();
  const reviewedBy = reviewer.user.login;
  await deps.builds.updateSnapshotReview([snapshot.id], { review, reviewedBy, reviewedAt });

  const refreshed = await refreshBuild(deps, project, build);
  const reviewed = { ...snapshot, review, reviewedBy, reviewedAt: reviewedAt.toISOString() };
  return { snapshot: toSnapshot(reviewed), ...withSummary(refreshed) };
}

/** `POST /api/builds/:id/approve-all`: approve every reviewable snapshot still pending. */
export async function approveAll(
  deps: ReviewDeps,
  reviewer: Reviewer,
  buildId: string,
): Promise<ApproveAllResponse> {
  const { build, project } = await requireReviewableBuild(deps, reviewer, buildId);
  const pending = (await deps.builds.listSnapshots(build.id)).filter(
    (snapshot) => needsReview(snapshot.state) && snapshot.review === 'pending',
  );
  if (pending.length === 0) return { ...withSummary(build), approvedCount: 0 };

  await recordApprovals(deps, reviewer, project, pending);
  await deps.builds.updateSnapshotReview(
    pending.map((snapshot) => snapshot.id),
    { review: 'approved', reviewedBy: reviewer.user.login, reviewedAt: deps.clock.now() },
  );
  const refreshed = await refreshBuild(deps, project, build);
  return { ...withSummary(refreshed), approvedCount: pending.length };
}
