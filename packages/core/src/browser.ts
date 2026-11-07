// `@targus/core/browser`: everything in @targus/core that runs in a browser, which is all of it
// except the PNG image code (diffImages, isBlankPng). That code is built on pngjs, which needs
// Node's util, zlib and stream, so it is exported only from the root entry (index.ts). The web
// app imports this entry, never the root (ADR 0025, enforced by .dependency-cruiser.cjs).
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
export * from './ports/index.ts';
export { acceptedImageHash } from './snapshots/accepted-image-hash.ts';
export {
  compareSnapshot,
  defaultThreshold,
  type ApprovalPair,
  type CompareSnapshotInput,
} from './snapshots/compare-snapshot.ts';
export { libraryStories } from './snapshots/library-stories.ts';
