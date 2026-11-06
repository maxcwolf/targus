// Public surface of @targus/core. Pure domain code only: no I/O, no Node builtins, and no
// dependency other than zod, pixelmatch and pngjs (enforced by .dependency-cruiser.cjs).
export {
  baselineResolutionCases,
  type BaselineResolutionCase,
} from './baseline/baseline-resolution-cases.ts';
export {
  baselineShaOrder,
  resolveBaseline,
  type BaselineCandidate,
} from './baseline/resolve-baseline.ts';
export {
  buildStatus,
  buildStatusFromTally,
  emptyTally,
  needsReview,
  tallySnapshots,
  type BuildReviewStatus,
  type BuildStatusResult,
  type SnapshotOutcome,
  type SnapshotTally,
} from './build-status.ts';
export * from './contracts/index.ts';
export { isTargusError, TargusError, targusErrorCodes, type TargusErrorCode } from './errors.ts';
export { diffImages, type DiffImagesOptions, type DiffImagesResult } from './images/diff-images.ts';
export { isBlankPng } from './images/is-blank.ts';
export * from './ports/index.ts';
export { acceptedImageHash } from './snapshots/accepted-image-hash.ts';
export {
  compareSnapshot,
  type ApprovalPair,
  type CompareSnapshotInput,
} from './snapshots/compare-snapshot.ts';
export { libraryStories } from './snapshots/library-stories.ts';
