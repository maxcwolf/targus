import type { Approval } from '../contracts/approval.ts';
import type { ImageHash, ReviewState, SnapshotState } from '../contracts/snapshot.ts';
import { TargusError } from '../errors.ts';
import type { SnapshotOutcome } from '../build-status.ts';

/**
 * The changed-pixel ratio at or under which a story is `unchanged`: 0.1% of pixels (plan.md
 * section 7). The server owns the threshold and sends the one it uses with every new build, so
 * the CLI diffs with the server's value, never its own (ADR 0028). This is the server's default
 * until a per-project setting replaces it.
 */
export const defaultThreshold = 0.001;

/** The approval fields `compareSnapshot` matches on, already scoped to the story and variant. */
export type ApprovalPair = Pick<Approval, 'fromHash' | 'toHash'>;

/** What `compareSnapshot` knows about one story in one build. */
export interface CompareSnapshotInput {
  /** This build's capture, or `null` when the story no longer exists. */
  readonly current: {
    /** The captured image; `null` exactly when the render errored, so there is no image. */
    readonly imageHash: ImageHash | null;
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

/** A capture that rendered: it must have an image to compare. */
function requireImage(imageHash: ImageHash | null): ImageHash {
  if (imageHash === null) {
    throw new TargusError('bad_request', 'a capture without an error needs an image hash');
  }
  return imageHash;
}

/**
 * Classify one story against its baseline and carry approvals forward (plan.md section 6,
 * rules 2 to 4):
 *
 * - no capture but a baseline: `removed`, informational, so already `approved`;
 * - the render errored: `error`, `pending` but never approvable, and it fails the build;
 * - no baseline: `new`, `approved` only if a new-story approval (`fromHash` null) matches;
 * - same hash, or diff ratio at or under the threshold: `unchanged`;
 * - unstable story: `unstable`, `approved` so it never blocks the build, though its capture
 *   never becomes the baseline (`acceptedImageHash`, ADR 0030). A story without a baseline is
 *   `new` first, so an `unstable` one always has a baseline to keep;
 * - otherwise `changed`, `approved` only if an approval for this exact hash pair exists.
 *
 * A story that is in neither the build nor the baseline, and a capture with neither an error nor
 * an image, throw `TargusError('bad_request')`.
 */
export function compareSnapshot(input: CompareSnapshotInput): SnapshotOutcome {
  const { current, baseline, approvals } = input;
  if (current === null) return removedOutcome(baseline);
  if (current.error !== null) return outcome('error', 'pending');
  const imageHash = requireImage(current.imageHash);
  if (baseline === null) {
    return outcome('new', hasApproval(approvals, null, imageHash) ? 'approved' : 'pending');
  }
  const sameImage = imageHash === baseline.imageHash;
  if (sameImage || withinThreshold(input.diffRatio, input.threshold)) {
    return outcome('unchanged', 'approved');
  }
  if (current.unstable) return outcome('unstable', 'approved');
  const approved = hasApproval(approvals, baseline.imageHash, imageHash);
  return outcome('changed', approved ? 'approved' : 'pending');
}
