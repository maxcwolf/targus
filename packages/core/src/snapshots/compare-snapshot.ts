import type { Approval } from '../contracts/approval.js';
import type { ImageHash, ReviewState, SnapshotState } from '../contracts/snapshot.js';
import { TargusError } from '../errors.js';
import type { SnapshotOutcome } from '../build-status.js';

/** The approval fields `compareSnapshot` matches on, already scoped to the story and variant. */
export type ApprovalPair = Pick<Approval, 'fromHash' | 'toHash'>;

/** What `compareSnapshot` knows about one story in one build. */
export interface CompareSnapshotInput {
  /** This build's capture, or `null` when the story no longer exists. */
  readonly current: {
    readonly imageHash: ImageHash;
    /** The story is marked unstable (e.g. it animates), so a change never blocks the build. */
    readonly unstable: boolean;
    readonly error: string | null;
  } | null;
  /** The baseline build's accepted image for the story, or `null` when it lacks the story. */
  readonly baseline: { readonly imageHash: ImageHash } | null;
  /** Changed-pixel ratio from `diffImages`, or `null` when no diff was computed. */
  readonly diffRatio: number | null;
  /** The story's failure threshold on `diffRatio`. */
  readonly threshold: number;
  /** Recorded approvals for this project, story and variant. */
  readonly approvals: readonly ApprovalPair[];
}

function hasApproval(
  approvals: readonly ApprovalPair[],
  fromHash: ImageHash | null,
  toHash: ImageHash,
): boolean {
  return approvals.some((approval) => approval.fromHash === fromHash && approval.toHash === toHash);
}

function outcome(state: SnapshotState, review: ReviewState): SnapshotOutcome {
  return { state, review };
}

function withinThreshold(diffRatio: number | null, threshold: number): boolean {
  return diffRatio !== null && diffRatio <= threshold;
}

/** A story the baseline has but this build lacks. `removed` is informational, never reviewed. */
function removedOutcome(baseline: CompareSnapshotInput['baseline']): SnapshotOutcome {
  if (baseline === null) {
    throw new TargusError('bad_request', 'a story needs a capture or a baseline');
  }
  return outcome('removed', 'approved');
}

/**
 * Classify one story against its baseline and carry approvals forward (plan.md section 6,
 * rules 2 to 4):
 *
 * - no capture but a baseline: `removed`, informational, so already `approved`;
 * - the render errored: `error`, `pending` but never approvable, and it fails the build;
 * - no baseline: `new`, `approved` only if a new-story approval (`fromHash` null) matches;
 * - same hash, or diff ratio at or under the threshold: `unchanged`;
 * - unstable story: `unstable`, which never blocks the build;
 * - otherwise `changed`, `approved` only if an approval for this exact hash pair exists.
 *
 * A story that is in neither the build nor the baseline throws `TargusError('bad_request')`.
 */
export function compareSnapshot(input: CompareSnapshotInput): SnapshotOutcome {
  const { current, baseline, approvals } = input;
  if (current === null) return removedOutcome(baseline);
  if (current.error !== null) return outcome('error', 'pending');
  if (baseline === null) {
    return outcome('new', hasApproval(approvals, null, current.imageHash) ? 'approved' : 'pending');
  }
  const sameImage = current.imageHash === baseline.imageHash;
  if (sameImage || withinThreshold(input.diffRatio, input.threshold)) {
    return outcome('unchanged', 'approved');
  }
  if (current.unstable) return outcome('unstable', 'approved');
  const approved = hasApproval(approvals, baseline.imageHash, current.imageHash);
  return outcome('changed', approved ? 'approved' : 'pending');
}
