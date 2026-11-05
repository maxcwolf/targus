import {
  baselineBuildStatuses,
  emptyTally,
  type Build,
  type BuildRepository,
  type BuildStatus,
  type NewBuild,
  type ReviewState,
  type Snapshot,
  type SnapshotTally,
} from '@targus/core';
import { and, asc, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { builds, snapshots } from '../db/schema.js';
import { chunkForD1 } from './d1-limits.js';

/** A stored snapshot: the wire `Snapshot` plus the capture-hygiene fields only D1 keeps. */
export interface SnapshotRecord extends Snapshot {
  readonly blank: boolean;
  /** The render error of an `error` snapshot, else null. */
  readonly error: string | null;
}

/** A stored build: the wire `Build` plus its persisted snapshot tally. */
export interface BuildRecord extends Build {
  readonly tally: SnapshotTally;
}

/** What `complete` writes when a build's results arrive. */
export interface BuildCompletion {
  readonly status: BuildStatus;
  readonly tally: SnapshotTally;
  readonly completedAt: Date;
  readonly checkRunId: number | null;
}

/** What `updateReview` writes after a reviewer's decision. */
export interface BuildReviewUpdate {
  readonly status: BuildStatus;
  readonly tally: SnapshotTally;
}

/** What `updateSnapshotReview` writes on each snapshot. */
export interface SnapshotReviewUpdate {
  readonly review: ReviewState;
  readonly reviewedBy: string;
  readonly reviewedAt: Date;
}

/** `BuildRepository` plus the reads and writes the API's use-cases need. */
export interface ApiBuildRepository extends BuildRepository {
  create(build: NewBuild, tally?: SnapshotTally): Promise<BuildRecord>;
  findById(projectId: string, buildId: string): Promise<BuildRecord | null>;
  findLatestSuccessfulForShas(
    projectId: string,
    shas: readonly string[],
  ): Promise<BuildRecord | null>;
  /** A build of any project; the caller authorizes it through its project. */
  findAnyById(buildId: string): Promise<BuildRecord | null>;
  /** The newest `limit` builds of a project, by number descending. */
  listForProject(projectId: string, limit: number): Promise<BuildRecord[]>;
  complete(buildId: string, completion: BuildCompletion): Promise<void>;
  updateReview(buildId: string, update: BuildReviewUpdate): Promise<void>;
  listSnapshots(buildId: string): Promise<SnapshotRecord[]>;
  saveSnapshots(buildId: string, records: readonly SnapshotRecord[]): Promise<void>;
  findSnapshotById(snapshotId: string): Promise<SnapshotRecord | null>;
  updateSnapshotReview(snapshotIds: readonly string[], update: SnapshotReviewUpdate): Promise<void>;
}

type BuildRow = typeof builds.$inferSelect;
type SnapshotRow = typeof snapshots.$inferSelect;

/** The tally as the eight `builds` count columns. */
function tallyColumns(tally: SnapshotTally) {
  return {
    pendingCount: tally.pendingCount,
    deniedCount: tally.deniedCount,
    unchangedCount: tally.counts.unchanged,
    changedCount: tally.counts.changed,
    newCount: tally.counts.new,
    removedCount: tally.counts.removed,
    unstableCount: tally.counts.unstable,
    errorCount: tally.counts.error,
  };
}

function toTally(row: BuildRow): SnapshotTally {
  return {
    counts: {
      unchanged: row.unchangedCount,
      changed: row.changedCount,
      new: row.newCount,
      removed: row.removedCount,
      unstable: row.unstableCount,
      error: row.errorCount,
    },
    pendingCount: row.pendingCount,
    deniedCount: row.deniedCount,
  };
}

/** Every `Build` column with ISO timestamps, plus the tally. */
function toBuildRecord(row: BuildRow): BuildRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    number: row.number,
    sha: row.sha,
    branch: row.branch,
    prNumber: row.prNumber,
    mergeBaseSha: row.mergeBaseSha,
    baselineBuildId: row.baselineBuildId,
    trigger: row.trigger,
    device: row.device,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
    checkRunId: row.checkRunId,
    tally: toTally(row),
  };
}

function toSnapshotRecord(row: SnapshotRow): SnapshotRecord {
  return { ...row, reviewedAt: row.reviewedAt === null ? null : row.reviewedAt.toISOString() };
}

function toSnapshotRow(buildId: string, record: SnapshotRecord): SnapshotRow {
  const reviewedAt = record.reviewedAt === null ? null : new Date(record.reviewedAt);
  return { ...record, buildId, reviewedAt };
}

/**
 * D1 adapter for `builds` and `snapshots`. Build reads are scoped by project (ADR 0007), except
 * `findAnyById`, whose callers authorize through the build's project.
 */
export class D1BuildRepository implements ApiBuildRepository {
  private readonly db;

  constructor(database: D1Database) {
    this.db = drizzle(database);
  }

  async create(build: NewBuild, tally: SnapshotTally = emptyTally): Promise<BuildRecord> {
    // One statement, so concurrent creates cannot both take the same number.
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

  async listForProject(projectId: string, limit: number): Promise<BuildRecord[]> {
    const rows = await this.db
      .select()
      .from(builds)
      .where(eq(builds.projectId, projectId))
      .orderBy(desc(builds.number))
      .limit(limit);
    return rows.map(toBuildRecord);
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

  async complete(buildId: string, completion: BuildCompletion): Promise<void> {
    const { status, tally, completedAt, checkRunId } = completion;
    await this.db
      .update(builds)
      .set({ status, completedAt, checkRunId, ...tallyColumns(tally) })
      .where(eq(builds.id, buildId));
  }

  async updateReview(buildId: string, update: BuildReviewUpdate): Promise<void> {
    await this.db
      .update(builds)
      .set({ status: update.status, ...tallyColumns(update.tally) })
      .where(eq(builds.id, buildId));
  }

  async listSnapshots(buildId: string): Promise<SnapshotRecord[]> {
    const rows = await this.db
      .select()
      .from(snapshots)
      .where(eq(snapshots.buildId, buildId))
      .orderBy(asc(snapshots.storyId), asc(snapshots.variant));
    return rows.map(toSnapshotRecord);
  }

  async saveSnapshots(buildId: string, records: readonly SnapshotRecord[]): Promise<void> {
    const rows = records.map((record) => toSnapshotRow(buildId, record));
    const columns = Object.keys(getTableColumns(snapshots)).length;
    const [first, ...rest] = chunkForD1(rows, columns).map((chunk) =>
      this.db.insert(snapshots).values(chunk),
    );
    if (first === undefined) return;
    await this.db.batch([first, ...rest]);
  }

  async findSnapshotById(snapshotId: string): Promise<SnapshotRecord | null> {
    const row = await this.db.select().from(snapshots).where(eq(snapshots.id, snapshotId)).get();
    return row === undefined ? null : toSnapshotRecord(row);
  }

  async updateSnapshotReview(
    snapshotIds: readonly string[],
    update: SnapshotReviewUpdate,
  ): Promise<void> {
    // Each chunk binds its ids plus the three SET values; two per id keeps it under the limit.
    const [first, ...rest] = chunkForD1(snapshotIds, 2).map((ids) =>
      this.db.update(snapshots).set(update).where(inArray(snapshots.id, ids)),
    );
    if (first === undefined) return;
    await this.db.batch([first, ...rest]);
  }
}
