import {
  baselineBuildStatuses,
  emptyTally,
  type BuildRepository,
  type BuildStatus,
  type NewBuild,
  type ReviewState,
  type SnapshotTally,
} from '@targus/core';
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { builds, snapshots } from '../db/schema.ts';
import {
  checkBuildPageLimit,
  decodeBuildCursor,
  toBuildPage,
  type BuildPage,
  type BuildPageRequest,
} from './build-page.ts';
import { chunkForD1 } from './d1-limits.ts';
import {
  buildInProgress,
  checkRunClaim,
  guardedSnapshotInserts,
  runBatch,
  tallyColumns,
  toBuildRecord,
  toSnapshotRecord,
  toSnapshotRow,
  type BuildRecord,
  type SnapshotRecord,
} from './build-rows.ts';

export type { BuildPage, BuildPageRequest } from './build-page.ts';
export type { BuildRecord, SnapshotRecord } from './build-rows.ts';

/** What `completeWithResults` writes on the build when its results arrive. */
export interface BuildCompletion {
  readonly status: BuildStatus;
  readonly tally: SnapshotTally;
  readonly completedAt: Date;
}

/** A build's snapshots as of one read, and the review version they were read at. */
export interface BuildReviewRead {
  readonly version: number;
  readonly snapshots: SnapshotRecord[];
}

/** A reviewer's decision on some snapshots of a build, and the status it folds the build to. */
export interface ReviewCommit {
  readonly snapshotIds: readonly string[];
  readonly review: ReviewState;
  readonly reviewedBy: string;
  readonly reviewedAt: Date;
  readonly status: BuildStatus;
  readonly tally: SnapshotTally;
}

/** A build to open, with the caller's idempotency key when it sent one (ADR 0027). */
export interface NewApiBuild extends NewBuild {
  readonly idempotencyKey?: string | null;
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
    shas: readonly string[],
  ): Promise<BuildRecord | null>;
  /** A build of any project; the caller authorizes it through its project. */
  findAnyById(buildId: string): Promise<BuildRecord | null>;
  /**
   * One page of a project's builds, by number descending (see build-page.ts). Throws
   * `bad_request` for a limit outside 1..`maxBuildsPageLimit` or a cursor it did not issue.
   */
  listForProject(projectId: string, page: BuildPageRequest): Promise<BuildPage>;
  /** The newest signed-off build (`baselineBuildStatuses`) of a project on `branch`. */
  findLatestBaselineOnBranch(projectId: string, branch: string): Promise<BuildRecord | null>;
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
   * Write a review decision and the build's new status and tally in one transaction, only if
   * the build is still at `readVersion`, and move it to the next version. False, with nothing
   * written, when another review committed first; the caller re-reads and decides again.
   */
  commitReview(buildId: string, readVersion: number, commit: ReviewCommit): Promise<boolean>;
}

/**
 * D1 adapter for `builds` and `snapshots`. Build reads are scoped by project (ADR 0007), except
 * `findAnyById`, whose callers authorize through the build's project.
 */
export class D1BuildRepository implements ApiBuildRepository {
  private readonly db;

  constructor(private readonly database: D1Database) {
    this.db = drizzle(database);
  }

  async create(build: NewApiBuild, tally: SnapshotTally = emptyTally): Promise<BuildRecord> {
    // One statement, so concurrent creates cannot both take the same number. On a key the
    // project already used, the upsert leaves the stored build as it is and returns it, so
    // concurrent replays open one build between them (ADR 0027).
    const nextNumber = sql<number>`(SELECT COALESCE(MAX(${builds.number}), 0) + 1 FROM ${builds} WHERE ${builds.projectId} = ${build.projectId})`;
    const row = await this.db
      .insert(builds)
      .values({
        ...build,
        ...tallyColumns(tally),
        number: nextNumber,
        createdAt: new Date(build.createdAt),
        completedAt: build.completedAt === null ? null : new Date(build.completedAt),
      })
      .onConflictDoUpdate({
        target: [builds.projectId, builds.idempotencyKey],
        set: { idempotencyKey: sql`${builds.idempotencyKey}` },
      })
      .returning()
      .get();
    return toBuildRecord(row);
  }

  async findById(projectId: string, buildId: string): Promise<BuildRecord | null> {
    const row = await this.db
      .select()
      .from(builds)
      .where(and(eq(builds.projectId, projectId), eq(builds.id, buildId)))
      .get();
    return row === undefined ? null : toBuildRecord(row);
  }

  async findAnyById(buildId: string): Promise<BuildRecord | null> {
    const row = await this.db.select().from(builds).where(eq(builds.id, buildId)).get();
    return row === undefined ? null : toBuildRecord(row);
  }

  /** Keyset paging on `builds_project_number_unique`: `number < cursor`, one extra row read. */
  async listForProject(projectId: string, page: BuildPageRequest): Promise<BuildPage> {
    const limit = checkBuildPageLimit(page.limit);
    const before = page.cursor === undefined ? undefined : decodeBuildCursor(page.cursor);
    const rows = await this.db
      .select()
      .from(builds)
      .where(
        and(
          eq(builds.projectId, projectId),
          before === undefined ? undefined : lt(builds.number, before),
        ),
      )
      .orderBy(desc(builds.number))
      .limit(limit + 1);
    return toBuildPage(rows.map(toBuildRecord), limit);
  }

  async findLatestBaselineOnBranch(projectId: string, branch: string): Promise<BuildRecord | null> {
    const row = await this.db
      .select()
      .from(builds)
      .where(
        and(
          eq(builds.projectId, projectId),
          eq(builds.branch, branch),
          inArray(builds.status, [...baselineBuildStatuses]),
        ),
      )
      .orderBy(desc(builds.number))
      .limit(1)
      .get();
    return row === undefined ? null : toBuildRecord(row);
  }

  /**
   * The SQL form of core's `resolveBaseline`: the first sha in `shas` order with a successful
   * build, then the latest `createdAt`, ties broken by the greater id. `shas` travels as one
   * JSON parameter because D1 binds at most 100 parameters and the CLI sends up to 101 shas.
   */
  async findLatestSuccessfulForShas(
    projectId: string,
    shas: readonly string[],
  ): Promise<BuildRecord | null> {
    if (shas.length === 0) return null;
    const order = JSON.stringify(shas);
    const row = await this.db
      .select()
      .from(builds)
      .where(
        and(
          eq(builds.projectId, projectId),
          inArray(builds.status, [...baselineBuildStatuses]),
          sql`${builds.sha} IN (SELECT value FROM json_each(${order}))`,
        ),
      )
      .orderBy(
        sql`(SELECT MIN(key) FROM json_each(${order}) WHERE value = ${builds.sha})`,
        desc(builds.createdAt),
        desc(builds.id),
      )
      .limit(1)
      .get();
    return row === undefined ? null : toBuildRecord(row);
  }

  /**
   * One D1 batch, which D1 runs as a transaction. Every statement is guarded by the build still
   * being `in_progress`, and the status change comes last, so either all of it applies or none.
   * The first statement clears snapshots an `in_progress` build should not have; only builds
   * wedged by the non-atomic write this replaced have any.
   */
  async completeWithResults(
    buildId: string,
    records: readonly SnapshotRecord[],
    completion: BuildCompletion,
  ): Promise<boolean> {
    const { status, tally, completedAt } = completion;
    const rows = records.map((record) => toSnapshotRow(buildId, record));
    const clear = this.db
      .delete(snapshots)
      .where(and(eq(snapshots.buildId, buildId), buildInProgress(buildId)));
    const inserts = guardedSnapshotInserts(rows, buildInProgress(buildId), 2);
    const complete = this.db
      .update(builds)
      .set({ status, completedAt, ...tallyColumns(tally) })
      .where(and(eq(builds.id, buildId), eq(builds.status, 'in_progress')))
      .returning({ id: builds.id });
    const results = await runBatch(this.database, [clear.toSQL(), ...inserts, complete.toSQL()]);
    return results.at(-1)?.results.length === 1;
  }

  async setCheckRunId(buildId: string, checkRunId: number): Promise<void> {
    await this.db.update(builds).set({ checkRunId }).where(eq(builds.id, buildId));
  }

  /** The claim lives in `check_run_id` as minus its time in ms; see `checkRunClaim`. */
  async claimCheckRun(buildId: string, claimedAt: Date, staleBefore: Date): Promise<boolean> {
    const free = or(
      isNull(builds.checkRunId),
      and(lt(builds.checkRunId, 0), gt(builds.checkRunId, checkRunClaim(staleBefore))),
    );
    const claimed = await this.db
      .update(builds)
      .set({ checkRunId: checkRunClaim(claimedAt) })
      .where(and(eq(builds.id, buildId), free))
      .returning({ id: builds.id });
    return claimed.length === 1;
  }

  async releaseCheckRunClaim(buildId: string, claimedAt: Date): Promise<void> {
    await this.db
      .update(builds)
      .set({ checkRunId: null })
      .where(and(eq(builds.id, buildId), eq(builds.checkRunId, checkRunClaim(claimedAt))));
  }

  async listSnapshots(buildId: string): Promise<SnapshotRecord[]> {
    const rows = await this.db
      .select()
      .from(snapshots)
      .where(eq(snapshots.buildId, buildId))
      .orderBy(asc(snapshots.storyId), asc(snapshots.variant));
    return rows.map(toSnapshotRecord);
  }

  async findSnapshotById(snapshotId: string): Promise<SnapshotRecord | null> {
    const row = await this.db.select().from(snapshots).where(eq(snapshots.id, snapshotId)).get();
    return row === undefined ? null : toSnapshotRecord(row);
  }

  async readForReview(buildId: string): Promise<BuildReviewRead> {
    const [versions, rows] = await this.db.batch([
      this.db.select({ version: builds.reviewVersion }).from(builds).where(eq(builds.id, buildId)),
      this.db
        .select()
        .from(snapshots)
        .where(eq(snapshots.buildId, buildId))
        .orderBy(asc(snapshots.storyId), asc(snapshots.variant)),
    ]);
    return { version: versions[0]?.version ?? 0, snapshots: rows.map(toSnapshotRecord) };
  }

  /**
   * One D1 batch (one transaction): the snapshot updates first, each guarded by the build still
   * being at `readVersion`, then the build's update, which bumps the version under the same
   * guard. So the tally written is always the one of the snapshots as stored at commit time.
   */
  async commitReview(buildId: string, readVersion: number, commit: ReviewCommit): Promise<boolean> {
    const { snapshotIds, review, reviewedBy, reviewedAt, status, tally } = commit;
    const atVersion = sql`EXISTS (SELECT 1 FROM ${builds} WHERE ${builds.id} = ${buildId} AND ${builds.reviewVersion} = ${readVersion})`;
    // Each chunk binds its ids, the three SET values, the build id and the two guard values.
    const decisions = chunkForD1(snapshotIds, 1, 6).map((ids) =>
      this.db
        .update(snapshots)
        .set({ review, reviewedBy, reviewedAt })
        .where(and(inArray(snapshots.id, ids), eq(snapshots.buildId, buildId), atVersion)),
    );
    const fold = this.db
      .update(builds)
      .set({ status, ...tallyColumns(tally), reviewVersion: sql`${builds.reviewVersion} + 1` })
      .where(and(eq(builds.id, buildId), eq(builds.reviewVersion, readVersion)))
      .returning({ id: builds.id });
    const statements = [...decisions, fold].map((statement) => statement.toSQL());
    const results = await runBatch(this.database, statements);
    return results.at(-1)?.results.length === 1;
  }
}
