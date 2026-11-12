import { baselineBuildStatuses, emptyTally, type Platform, type SnapshotTally } from '@targus/core';
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { builds, snapshots } from '../db/schema.ts';
import { checkBuildPageLimit, decodeBuildCursor, toBuildPage } from '../ports/build-page.ts';
import type {
  ApiBuildRepository,
  BuildCompletion,
  BuildPage,
  BuildPageRequest,
  BuildRecord,
  BuildReviewRead,
  NewApiBuild,
  ReviewCommit,
  SnapshotRecord,
  StoryHistoryRecord,
  StoryRef,
} from '../ports/build-repository.ts';
import {
  buildInProgress,
  checkRunClaim,
  guardedSnapshotInserts,
  runBatch,
  storyHistoryFilter,
  tallyColumns,
  toBuildRecord,
  toSnapshotRecord,
  toSnapshotRow,
} from './build-rows.ts';
import { reviewCommitStatements } from './review-commit.ts';

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

  async findLatestBaselineOnBranch(
    projectId: string,
    platform: Platform,
    branch: string,
  ): Promise<BuildRecord | null> {
    const row = await this.db
      .select()
      .from(builds)
      .where(
        and(
          eq(builds.projectId, projectId),
          eq(builds.platform, platform),
          eq(builds.branch, branch),
          inArray(builds.status, [...baselineBuildStatuses]),
        ),
      )
      .orderBy(desc(builds.number))
      .limit(1)
      .get();
    return row === undefined ? null : toBuildRecord(row);
  }

  async findNewestCompletedForSha(
    projectId: string,
    platform: Platform,
    sha: string,
  ): Promise<BuildRecord | null> {
    const row = await this.db
      .select()
      .from(builds)
      .where(
        and(
          eq(builds.projectId, projectId),
          eq(builds.platform, platform),
          eq(builds.sha, sha),
          ne(builds.status, 'in_progress'),
        ),
      )
      .orderBy(desc(builds.number))
      .limit(1)
      .get();
    return row === undefined ? null : toBuildRecord(row);
  }

  async listBaselinePlatformsOnBranch(projectId: string, branch: string): Promise<Platform[]> {
    const rows = await this.db
      .selectDistinct({ platform: builds.platform })
      .from(builds)
      .where(
        and(
          eq(builds.projectId, projectId),
          eq(builds.branch, branch),
          inArray(builds.status, [...baselineBuildStatuses]),
        ),
      );
    return rows.map((row) => row.platform);
  }

  /**
   * The SQL form of core's `resolveBaseline`: among the `platform` builds, the first sha in
   * `shas` order with a successful build, then the latest `createdAt`, ties broken by the
   * greater id. `shas` travels as one JSON parameter because D1 binds at most 100 parameters and
   * the CLI sends up to 101 shas.
   */
  async findLatestSuccessfulForShas(
    projectId: string,
    platform: Platform,
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
          eq(builds.platform, platform),
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
    const { status, tally, completedAt, resultsDigest } = completion;
    const rows = records.map((record) => toSnapshotRow(buildId, record));
    const clear = this.db
      .delete(snapshots)
      .where(and(eq(snapshots.buildId, buildId), buildInProgress(buildId)));
    const inserts = guardedSnapshotInserts(rows, buildInProgress(buildId), 2);
    const complete = this.db
      .update(builds)
      .set({ status, completedAt, resultsDigest, ...tallyColumns(tally) })
      .where(and(eq(builds.id, buildId), eq(builds.status, 'in_progress')))
      .returning({ id: builds.id });
    const results = await runBatch(this.database, [clear.toSQL(), ...inserts, complete.toSQL()]);
    return results.at(-1)?.results.length === 1;
  }

  async findResultsDigest(buildId: string): Promise<string | null> {
    const row = await this.db
      .select({ resultsDigest: builds.resultsDigest })
      .from(builds)
      .where(eq(builds.id, buildId))
      .get();
    return row?.resultsDigest ?? null;
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

  /**
   * Walks the project's builds newest first (`builds_project_number_unique`) and looks the story
   * up in each (`snapshots_build_story_variant_unique`), so it needs no index of its own.
   */
  async listStoryHistory(
    projectId: string,
    story: StoryRef,
    limit: number,
  ): Promise<StoryHistoryRecord[]> {
    const rows = await this.db
      .select({ build: builds, snapshot: snapshots })
      .from(builds)
      .innerJoin(snapshots, eq(snapshots.buildId, builds.id))
      .where(storyHistoryFilter(projectId, story))
      .orderBy(desc(builds.number))
      .limit(limit);
    return rows.map(({ build, snapshot }) => ({
      build: toBuildRecord(build),
      snapshot: toSnapshotRecord(snapshot),
    }));
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
   * One D1 batch (one transaction), every statement guarded by the build still being at
   * `readVersion` and the build's own update last (see review-commit.ts). So the tally written
   * is always the one of the snapshots as stored at commit time, and the approvals change only
   * with the decision that changes them.
   */
  async commitReview(buildId: string, readVersion: number, commit: ReviewCommit): Promise<boolean> {
    const statements = reviewCommitStatements(this.db, buildId, readVersion, commit);
    const results = await runBatch(this.database, statements);
    return results.at(-1)?.results.length === 1;
  }
}
