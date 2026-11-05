import {
  baselineBuildStatuses,
  type Build,
  type BuildRepository,
  type BuildStatus,
  type NewBuild,
  type Snapshot,
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

/** `BuildRepository` plus the writes the results use-case needs. */
export interface ApiBuildRepository extends BuildRepository {
  listSnapshots(buildId: string): Promise<SnapshotRecord[]>;
  saveSnapshots(buildId: string, records: readonly SnapshotRecord[]): Promise<void>;
  updateStatus(
    buildId: string,
    status: BuildStatus,
    completedAt: Date,
    checkRunId?: number | null,
  ): Promise<void>;
}

type BuildRow = typeof builds.$inferSelect;
type SnapshotRow = typeof snapshots.$inferSelect;

/** The wire `Build`: every column, with ISO timestamps. */
function toBuild(row: BuildRow): Build {
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
  };
}

function toSnapshotRecord(row: SnapshotRow): SnapshotRecord {
  return { ...row, reviewedAt: row.reviewedAt === null ? null : row.reviewedAt.toISOString() };
}

function toSnapshotRow(buildId: string, record: SnapshotRecord): SnapshotRow {
  const reviewedAt = record.reviewedAt === null ? null : new Date(record.reviewedAt);
  return { ...record, buildId, reviewedAt };
}

/** D1 adapter for `builds` and `snapshots`. Every build read is scoped by project (ADR 0007). */
export class D1BuildRepository implements ApiBuildRepository {
  private readonly db;

  constructor(database: D1Database) {
    this.db = drizzle(database);
  }

  async create(build: NewBuild): Promise<Build> {
    // One statement, so concurrent creates cannot both take the same number.
    const nextNumber = sql<number>`(SELECT COALESCE(MAX(${builds.number}), 0) + 1 FROM ${builds} WHERE ${builds.projectId} = ${build.projectId})`;
    const row = await this.db
      .insert(builds)
      .values({
        ...build,
        number: nextNumber,
        createdAt: new Date(build.createdAt),
        completedAt: build.completedAt === null ? null : new Date(build.completedAt),
      })
      .returning()
      .get();
    return toBuild(row);
  }

  async findById(projectId: string, buildId: string): Promise<Build | null> {
    const row = await this.db
      .select()
      .from(builds)
      .where(and(eq(builds.projectId, projectId), eq(builds.id, buildId)))
      .get();
    return row === undefined ? null : toBuild(row);
  }

  /**
   * The SQL form of core's `resolveBaseline`: the first sha in `shas` order with a successful
   * build, then the latest `createdAt`, ties broken by the greater id. `shas` travels as one
   * JSON parameter because D1 binds at most 100 parameters and the CLI sends up to 101 shas.
   */
  async findLatestSuccessfulForShas(
    projectId: string,
    shas: readonly string[],
  ): Promise<Build | null> {
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
    return row === undefined ? null : toBuild(row);
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

  async updateStatus(
    buildId: string,
    status: BuildStatus,
    completedAt: Date,
    checkRunId: number | null = null,
  ): Promise<void> {
    await this.db
      .update(builds)
      .set({ status, completedAt, checkRunId })
      .where(eq(builds.id, buildId));
  }
}
