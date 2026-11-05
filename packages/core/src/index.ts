// Public surface of @targus/core. Pure domain code only: no I/O, no Node builtins, and no
// dependency other than zod, pixelmatch and pngjs (enforced by .dependency-cruiser.cjs).
export {
  baselineResolutionCases,
  type BaselineResolutionCase,
} from './baseline/baseline-resolution-cases.js';
export {
  baselineShaOrder,
  resolveBaseline,
  type BaselineCandidate,
} from './baseline/resolve-baseline.js';
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
} from './build-status.js';
export * from './contracts/index.js';
export { isTargusError, TargusError, targusErrorCodes, type TargusErrorCode } from './errors.js';
export { diffImages, type DiffImagesOptions, type DiffImagesResult } from './images/diff-images.js';
export { isBlankPng } from './images/is-blank.js';
export * from './ports/index.js';
export { acceptedImageHash } from './snapshots/accepted-image-hash.js';
export {
  compareSnapshot,
  type ApprovalPair,
  type CompareSnapshotInput,
} from './snapshots/compare-snapshot.js';
