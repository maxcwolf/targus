import {
  buildStatusFromTally,
  needsReview,
  tallySnapshots,
  TargusError,
  type ApproveAllResponse,
  type BuildStatusSummary,
  type ReviewDecision,
  type ReviewSnapshotResponse,
  type ReviewState,
} from '@targus/core';

import type { BuildRecord, SnapshotRecord } from '../repositories/build.repository.ts';
import type { Project } from '../repositories/project.repository.ts';
import { requireBuildAccess } from './access.service.ts';
import { toSnapshot, withSummary } from './build.service.ts';
import { syncCheckRun } from './check-run.ts';
import type { ServiceDeps } from './deps.ts';
import type { Reviewer } from './principal.ts';

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

/** Record the approval of each snapshot's hash pair; a pair already approved stays as it is. */
async function recordApprovals(
  deps: ReviewDeps,
  reviewer: Reviewer,
  project: Project,
  snapshots: readonly SnapshotRecord[],
): Promise<void> {
  const approvedAt = deps.clock.now().toISOString();
  for (const snapshot of snapshots) {
    const [projectId, storyId, variant, fromHash, toHash] = pairOf(project, snapshot);
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

/** How often a decision is re-read and retried when another review of the build commits first. */
const commitAttempts = 5;

interface Decision {
  readonly review: ReviewState;
  readonly reviewedBy: string;
  readonly reviewedAt: Date;
}

/** What a committed decision changed. */
interface Committed {
  readonly build: BuildRecord;
  readonly summary: BuildStatusSummary;
  /** The snapshots the decision applied to, as they now are. */
  readonly decided: SnapshotRecord[];
}

/**
 * Apply `decision` to the snapshots `pick` chooses and fold the build's tally and status from
 * all of them, committing only if no other review changed the build since they were read
 * (ADR 0013). Otherwise read again and redo it, so two reviewers acting at once cannot leave
 * a tally computed before the other's change.
 */
async function commitDecision(
  deps: ReviewDeps,
  build: BuildRecord,
  pick: (snapshots: readonly SnapshotRecord[]) => SnapshotRecord[],
  decision: Decision,
): Promise<Committed> {
  const reviewed = { ...decision, reviewedAt: decision.reviewedAt.toISOString() };
  for (let attempt = 0; attempt < commitAttempts; attempt += 1) {
    const { version, snapshots } = await deps.builds.readForReview(build.id);
    const ids = new Set(pick(snapshots).map((snapshot) => snapshot.id));
    const after = snapshots.map((s) => (ids.has(s.id) ? { ...s, ...reviewed } : s));
    const tally = tallySnapshots(after);
    const summary = buildStatusFromTally(tally);
    const commit = { ...decision, snapshotIds: [...ids], status: summary.status, tally };
    if (await deps.builds.commitReview(build.id, version, commit)) {
      const decided = after.filter((snapshot) => ids.has(snapshot.id));
      return { build: { ...build, status: summary.status, tally }, summary, decided };
    }
  }
  throw new TargusError('conflict', `build ${build.id} is being reviewed concurrently; retry`);
}

/**
 * `POST /api/snapshots/:id/review`. Approving records the hash-pair approval so later builds
 * carry it forward; denying withdraws that pair's approval. Repeating a decision is a no-op.
 * The approval changes after the decision commits, so a decision that never commits leaves
 * the approvals alone.
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
  const pair = pairOf(project, snapshot);

  const committed = await commitDecision(
    deps,
    build,
    (snapshots) => snapshots.filter((s) => s.id === snapshot.id),
    { review, reviewedBy: reviewer.user.login, reviewedAt: deps.clock.now() },
  );
  if (review === 'approved') await recordApprovals(deps, reviewer, project, [snapshot]);
  else await deps.approvals.delete(...pair);
  await syncCheckRun(deps, project, committed.build, committed.summary);
  const [reviewed = snapshot] = committed.decided;
  return { snapshot: toSnapshot(reviewed), ...withSummary(committed.build) };
}

/** `POST /api/builds/:id/approve-all`: approve every reviewable snapshot still pending. */
export async function approveAll(
  deps: ReviewDeps,
  reviewer: Reviewer,
  buildId: string,
): Promise<ApproveAllResponse> {
  const { build, project } = await requireReviewableBuild(deps, reviewer, buildId);
  const pendingOf = (snapshots: readonly SnapshotRecord[]) =>
    snapshots.filter((snapshot) => needsReview(snapshot.state) && snapshot.review === 'pending');
  const pending = pendingOf(await deps.builds.listSnapshots(build.id));
  if (pending.length === 0) return { ...withSummary(build), approvedCount: 0 };
  // Refuse before anything is written if one of them cannot be approved.
  pending.forEach((snapshot) => pairOf(project, snapshot));

  const committed = await commitDecision(deps, build, pendingOf, {
    review: 'approved',
    reviewedBy: reviewer.user.login,
    reviewedAt: deps.clock.now(),
  });
  await recordApprovals(deps, reviewer, project, committed.decided);
  await syncCheckRun(deps, project, committed.build, committed.summary);
  return { ...withSummary(committed.build), approvedCount: committed.decided.length };
}
