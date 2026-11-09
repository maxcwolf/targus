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

import type { ApprovalIdentity } from '../ports/approval-repository.ts';
import type { ApprovalChanges, BuildRecord, SnapshotRecord } from '../ports/build-repository.ts';
import type { Project } from '../ports/project-repository.ts';
import { requireBuildAccess } from './access.service.ts';
import { toSnapshot, withSummary } from './build.service.ts';
import { syncCheckRun } from './check-run.ts';
import type { ServiceDeps } from './deps.ts';
import type { Reviewer } from './principal.ts';

type ReviewDeps = Pick<
  ServiceDeps,
  'builds' | 'clock' | 'config' | 'github' | 'ids' | 'log' | 'memberships' | 'projects'
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
function pairOf(project: Project, snapshot: SnapshotRecord): ApprovalIdentity {
  if (snapshot.imageHash === null) {
    throw new TargusError('conflict', 'only changed and new snapshots are reviewable');
  }
  return {
    projectId: project.id,
    storyId: snapshot.storyId,
    variant: snapshot.variant,
    fromHash: snapshot.baselineHash,
    toHash: snapshot.imageHash,
  };
}

/** How often a decision is re-read and retried when another review of the build commits first. */
const commitAttempts = 5;

interface Decision {
  readonly review: ReviewState;
  readonly reviewedBy: string;
  readonly reviewedAt: Date;
  /** The approvals the decision changes, given the snapshots it applies to. */
  readonly approvals: (decided: readonly SnapshotRecord[]) => ApprovalChanges;
}

/** What a committed decision changed. */
interface Committed {
  readonly build: BuildRecord;
  readonly summary: BuildStatusSummary;
  /** The build's review version after the commit. */
  readonly version: number;
  /** The snapshots the decision applied to, as they now are. */
  readonly decided: SnapshotRecord[];
}

/** Approving records each decided snapshot's hash pair, so later builds carry it forward. */
function recording(deps: ReviewDeps, project: Project, decision: Omit<Decision, 'approvals'>) {
  return (decided: readonly SnapshotRecord[]): ApprovalChanges => ({
    record: decided.map((snapshot) => ({
      id: deps.ids.next(),
      approval: {
        ...pairOf(project, snapshot),
        approvedBy: decision.reviewedBy,
        approvedAt: decision.reviewedAt.toISOString(),
      },
    })),
    withdraw: [],
  });
}

/** Denying withdraws each decided snapshot's hash pair. */
function withdrawing(project: Project) {
  return (decided: readonly SnapshotRecord[]): ApprovalChanges => ({
    record: [],
    withdraw: decided.map((snapshot) => pairOf(project, snapshot)),
  });
}

/**
 * Apply `decision` to the snapshots `pick` chooses, with the approvals it changes, and fold the
 * build's tally and status from all of them, committing only if no other review changed the
 * build since they were read (ADR 0013, ADR 0026). Otherwise read again and redo it, so two
 * reviewers acting at once cannot leave a tally computed before the other's change, and a
 * snapshot another review decided meanwhile is decided again only if `pick` still chooses it.
 */
async function commitDecision(
  deps: ReviewDeps,
  build: BuildRecord,
  pick: (snapshots: readonly SnapshotRecord[]) => SnapshotRecord[],
  decision: Decision,
): Promise<Committed> {
  const { review, reviewedBy, reviewedAt } = decision;
  const reviewed = { review, reviewedBy, reviewedAt: reviewedAt.toISOString() };
  for (let attempt = 0; attempt < commitAttempts; attempt += 1) {
    const { version, snapshots } = await deps.builds.readForReview(build.id);
    const picked = pick(snapshots);
    const ids = new Set(picked.map((snapshot) => snapshot.id));
    const after = snapshots.map((s) => (ids.has(s.id) ? { ...s, ...reviewed } : s));
    const tally = tallySnapshots(after);
    const summary = buildStatusFromTally(tally);
    const commit = {
      review,
      reviewedBy,
      reviewedAt,
      snapshotIds: [...ids],
      status: summary.status,
      tally,
      approvals: decision.approvals(picked),
    };
    if (await deps.builds.commitReview(build.id, version, commit)) {
      const decided = after.filter((snapshot) => ids.has(snapshot.id));
      const committed = { ...build, status: summary.status, tally };
      return { build: committed, summary, version: version + 1, decided };
    }
  }
  throw new TargusError('conflict', `build ${build.id} is being reviewed concurrently; retry`);
}

/**
 * `POST /api/snapshots/:id/review`. Approving records the hash-pair approval so later builds
 * carry it forward; denying withdraws that pair's approval. Repeating a decision is a no-op.
 * The approval changes in the same write as the decision, so a decision that never commits
 * leaves the approvals alone, and of two decisions on one snapshot the later one's stands.
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
  pairOf(project, snapshot);

  const made = { review, reviewedBy: reviewer.user.login, reviewedAt: deps.clock.now() };
  const approvals = review === 'approved' ? recording(deps, project, made) : withdrawing(project);
  const committed = await commitDecision(
    deps,
    build,
    (snapshots) => snapshots.filter((s) => s.id === snapshot.id),
    { ...made, approvals },
  );
  await syncCheckRun(deps, project, committed.build, committed);
  const [reviewed = snapshot] = committed.decided;
  return { snapshot: toSnapshot(reviewed), ...withSummary(committed.build) };
}

/**
 * `POST /api/builds/:id/approve-all`: approve every reviewable snapshot pending when the request
 * reads the build. One that another review decides before this one commits keeps that decision
 * and is counted in `skippedCount` (ADR 0026).
 */
export async function approveAll(
  deps: ReviewDeps,
  reviewer: Reviewer,
  buildId: string,
): Promise<ApproveAllResponse> {
  const { build, project } = await requireReviewableBuild(deps, reviewer, buildId);
  const pendingOf = (snapshots: readonly SnapshotRecord[]) =>
    snapshots.filter((snapshot) => needsReview(snapshot.state) && snapshot.review === 'pending');
  const pending = pendingOf(await deps.builds.listSnapshots(build.id));
  if (pending.length === 0) return { ...withSummary(build), approvedCount: 0, skippedCount: 0 };
  // Refuse before anything is written if one of them cannot be approved.
  pending.forEach((snapshot) => pairOf(project, snapshot));
  const asked = new Set(pending.map((snapshot) => snapshot.id));

  const made = {
    review: 'approved' as const,
    reviewedBy: reviewer.user.login,
    reviewedAt: deps.clock.now(),
  };
  const committed = await commitDecision(
    deps,
    build,
    (snapshots) => pendingOf(snapshots).filter((snapshot) => asked.has(snapshot.id)),
    { ...made, approvals: recording(deps, project, made) },
  );
  await syncCheckRun(deps, project, committed.build, committed);
  const approvedCount = committed.decided.length;
  return {
    ...withSummary(committed.build),
    approvedCount,
    skippedCount: asked.size - approvedCount,
  };
}
