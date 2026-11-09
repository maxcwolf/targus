import type {
  Approval,
  Build,
  BuildRepository,
  BuildStatus,
  NewBuild,
  Platform,
  ReviewState,
  Snapshot,
  SnapshotTally,
} from '@targus/core';

import type { ApprovalIdentity } from './approval-repository.ts';

// The builds port of the API: the records it stores and the reads and writes its use-cases need.
// Every storage implementation (D1 today) and the in-memory double implement it and run the same
// contract suites (test/support/contracts/build*.contract.ts).
/** A stored snapshot: the wire `Snapshot` plus the capture-hygiene fields only the database keeps. */
export interface SnapshotRecord extends Snapshot {
  readonly blank: boolean;
  /** The render error of an `error` snapshot, else null. */
  readonly error: string | null;
}

/** A stored build: the wire `Build` plus its persisted snapshot tally. */
export interface BuildRecord extends Build {
  readonly tally: SnapshotTally;
}

/** What a decision changes in `approvals`, in the same transaction as the decision itself. */
export interface ApprovalChanges {
  /** Approvals to record; a pair already approved keeps its approval. */
  readonly record: readonly { readonly id: string; readonly approval: Approval }[];
  /** Pairs whose approval is withdrawn. */
  readonly withdraw: readonly ApprovalIdentity[];
}

/** A reviewer's decision on some snapshots of a build, and the status it folds the build to. */
export interface ReviewCommit {
  readonly snapshotIds: readonly string[];
  readonly review: ReviewState;
  readonly reviewedBy: string;
  readonly reviewedAt: Date;
  readonly status: BuildStatus;
  readonly tally: SnapshotTally;
  readonly approvals: ApprovalChanges;
}

/** What `completeWithResults` writes on the build when its results arrive. */
export interface BuildCompletion {
  readonly status: BuildStatus;
  readonly tally: SnapshotTally;
  readonly completedAt: Date;
  /** SHA-256 of the results request, so a resend of it can be told from other results. */
  readonly resultsDigest: string;
}

/** A build's snapshots as of one read, and the review version they were read at. */
export interface BuildReviewRead {
  readonly version: number;
  readonly snapshots: SnapshotRecord[];
}

/** A build to open, with the caller's idempotency key when it sent one (ADR 0027). */
export interface NewApiBuild extends NewBuild {
  readonly idempotencyKey?: string | null;
}

/** Which page of a project's builds to read. */
export interface BuildPageRequest {
  readonly limit: number;
  /** A previous page's `nextCursor`; absent for the newest page. */
  readonly cursor?: string | undefined;
}

/** One page of builds, newest first, and the cursor of the next (older) page, if any. */
export interface BuildPage {
  readonly builds: BuildRecord[];
  readonly nextCursor: string | null;
}

/** `BuildRepository` plus the reads and writes the API's use-cases need. */
export interface ApiBuildRepository extends BuildRepository {
  /**
   * Store a new build with the next number of its project. When the project already has a build
   * under `build.idempotencyKey`, nothing is written and that build is returned instead, so the
   * caller tells a replay by the id (ADR 0027). Throws when the id is taken.
   */
  create(build: NewApiBuild, tally?: SnapshotTally): Promise<BuildRecord>;
  findById(projectId: string, buildId: string): Promise<BuildRecord | null>;
  findLatestSuccessfulForShas(
    projectId: string,
    platform: Platform,
    shas: readonly string[],
  ): Promise<BuildRecord | null>;
  /** A build of any project; the caller authorizes it through its project. */
  findAnyById(buildId: string): Promise<BuildRecord | null>;
  /**
   * One page of a project's builds, by number descending (see build-page.ts). Throws
   * `bad_request` for a limit outside 1..`maxBuildsPageLimit` or a cursor it did not issue.
   */
  listForProject(projectId: string, page: BuildPageRequest): Promise<BuildPage>;
  /** The newest signed-off build (`baselineBuildStatuses`) of a project's `platform` on `branch`. */
  findLatestBaselineOnBranch(
    projectId: string,
    platform: Platform,
    branch: string,
  ): Promise<BuildRecord | null>;
  /** Every platform with a signed-off build of the project on `branch`, in no set order. */
  listBaselinePlatformsOnBranch(projectId: string, branch: string): Promise<Platform[]>;
  /**
   * Store a build's snapshots and move it out of `in_progress`, in one transaction, only if it
   * is still `in_progress` when the transaction runs. False, with nothing written, when it is
   * not: another submission got there first. Throws, with nothing written, when a snapshot is
   * rejected (such as a duplicate story and variant).
   */
  completeWithResults(
    buildId: string,
    records: readonly SnapshotRecord[],
    completion: BuildCompletion,
  ): Promise<boolean>;
  /**
   * The digest `completeWithResults` stored with the build's results; null while the build is
   * `in_progress`, for a build completed before digests were kept, or for an unknown build.
   */
  findResultsDigest(buildId: string): Promise<string | null>;
  /** Remember the check run created for a completed build, replacing any claim on it. */
  setCheckRunId(buildId: string, checkRunId: number): Promise<void>;
  /**
   * Claim the creation of the build's check run, so two requests that both see none do not
   * both create one. True when the build has no check run and no claim made at or after
   * `staleBefore` (an older one belongs to a request that died before it stored or released).
   * A claim reads as no check run (`checkRunId: null`).
   */
  claimCheckRun(buildId: string, claimedAt: Date, staleBefore: Date): Promise<boolean>;
  /** Drop the claim made at `claimedAt`, when the check run could not be created. */
  releaseCheckRunClaim(buildId: string, claimedAt: Date): Promise<void>;
  listSnapshots(buildId: string): Promise<SnapshotRecord[]>;
  findSnapshotById(snapshotId: string): Promise<SnapshotRecord | null>;
  /** The build's snapshots and its review version, read together. */
  readForReview(buildId: string): Promise<BuildReviewRead>;
  /**
   * Write a review decision, the approvals it records or withdraws, and the build's new status
   * and tally in one transaction, only if the build is still at `readVersion`, and move it to
   * the next version. False, with nothing written, when another review committed first; the
   * caller re-reads and decides again.
   */
  commitReview(buildId: string, readVersion: number, commit: ReviewCommit): Promise<boolean>;
}
