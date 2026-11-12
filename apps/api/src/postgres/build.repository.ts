import { baselineBuildStatuses, emptyTally, type Platform, type SnapshotTally } from '@targus/core';
import { and, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';

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
import { checkRunClaim, tallyColumns, toBuildRecord, toSnapshotRecord } from './build-rows.ts';
import { commitReview, completeWithResults } from './build-writes.ts';
import { byteOrder, inJson, returned, type PostgresDatabase } from './database.ts';
import { builds, projects, snapshots } from './schema.ts';

type Reader = Pick<PostgresDatabase, 'select'>;

function snapshotsOf(db: Reader, buildId: string) {
  return db
    .select()
    .from(snapshots)
    .where(eq(snapshots.buildId, buildId))
    .orderBy(byteOrder(snapshots.storyId), byteOrder(snapshots.variant));
}

/**
 * Postgres adapter for `builds` and `snapshots`. Build reads are scoped by project (ADR 0007),
 * except `findAnyById`, whose callers authorize through the build's project.
 */
export class PostgresBuildRepository implements ApiBuildRepository {
  constructor(private readonly db: PostgresDatabase) {}

  /**
   * Two creates of one project could read the same highest number, as Postgres runs them side by
   * side, so each first locks the project's row. `FOR NO KEY UPDATE` makes creates wait for one
   * another without blocking writes that only reference the project. On a key the project already
   * used, the upsert leaves the stored build as it is and returns it (ADR 0027).
   */
  create(build: NewApiBuild, tally: SnapshotTally = emptyTally): Promise<BuildRecord> {
    const nextNumber = sql<number>`(SELECT COALESCE(MAX(${builds.number}), 0) + 1 FROM ${builds} WHERE ${builds.projectId} = ${build.projectId})`;
    return this.db.transaction(async (tx) => {
      await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, build.projectId))
        .for('no key update');
      const rows = await tx
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
        .returning();
      return toBuildRecord(returned(rows));
    });
  }

  async findById(projectId: string, buildId: string): Promise<BuildRecord | null> {
    const [row] = await this.db
      .select()
      .from(builds)
      .where(and(eq(builds.projectId, projectId), eq(builds.id, buildId)));
    return row === undefined ? null : toBuildRecord(row);
  }

  async findAnyById(buildId: string): Promise<BuildRecord | null> {
    const [row] = await this.db.select().from(builds).where(eq(builds.id, buildId));
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
    const [row] = await this.db
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
      .limit(1);
    return row === undefined ? null : toBuildRecord(row);
  }

  async findNewestCompletedForSha(
    projectId: string,
    platform: Platform,
    sha: string,
  ): Promise<BuildRecord | null> {
    const [row] = await this.db
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
      .limit(1);
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
   * greater id. `shas` travels as one JSON parameter, read once for membership and once, with
   * its positions, for the order.
   */
  async findLatestSuccessfulForShas(
    projectId: string,
    platform: Platform,
    shas: readonly string[],
  ): Promise<BuildRecord | null> {
    if (shas.length === 0) return null;
    const order = JSON.stringify(shas);
    const [row] = await this.db
      .select()
      .from(builds)
      .where(
        and(
          eq(builds.projectId, projectId),
          eq(builds.platform, platform),
          inArray(builds.status, [...baselineBuildStatuses]),
          inJson(builds.sha, shas),
        ),
      )
      .orderBy(
        sql`(SELECT MIN(wanted.position) FROM json_array_elements_text(${order}::json) WITH ORDINALITY AS wanted(value, position) WHERE wanted.value = ${builds.sha})`,
        desc(builds.createdAt),
        sql`${byteOrder(builds.id)} DESC`,
      )
      .limit(1);
    return row === undefined ? null : toBuildRecord(row);
  }

  completeWithResults(
    buildId: string,
    records: readonly SnapshotRecord[],
    completion: BuildCompletion,
  ): Promise<boolean> {
    return completeWithResults(this.db, buildId, records, completion);
  }

  async findResultsDigest(buildId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ resultsDigest: builds.resultsDigest })
      .from(builds)
      .where(eq(builds.id, buildId));
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
    return (await snapshotsOf(this.db, buildId)).map(toSnapshotRecord);
  }

  /** As the D1 adapter: the project's builds newest first, the story looked up in each. */
  async listStoryHistory(
    projectId: string,
    story: StoryRef,
    limit: number,
  ): Promise<StoryHistoryRecord[]> {
    const rows = await this.db
      .select({ build: builds, snapshot: snapshots })
      .from(builds)
      .innerJoin(snapshots, eq(snapshots.buildId, builds.id))
      .where(
        and(
          eq(builds.projectId, projectId),
          eq(builds.platform, story.platform),
          eq(snapshots.storyId, story.storyId),
          eq(snapshots.variant, story.variant),
          ne(snapshots.state, 'unchanged'),
        ),
      )
      .orderBy(desc(builds.number))
      .limit(limit);
    return rows.map(({ build, snapshot }) => ({
      build: toBuildRecord(build),
      snapshot: toSnapshotRecord(snapshot),
    }));
  }

  async findSnapshotById(snapshotId: string): Promise<SnapshotRecord | null> {
    const [row] = await this.db.select().from(snapshots).where(eq(snapshots.id, snapshotId));
    return row === undefined ? null : toSnapshotRecord(row);
  }

  /** Both reads see one snapshot of the database, as D1's batch gives its adapter. */
  readForReview(buildId: string): Promise<BuildReviewRead> {
    return this.db.transaction(
      async (tx) => {
        const [build] = await tx
          .select({ version: builds.reviewVersion })
          .from(builds)
          .where(eq(builds.id, buildId));
        const rows = await snapshotsOf(tx, buildId);
        return { version: build?.version ?? 0, snapshots: rows.map(toSnapshotRecord) };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  commitReview(buildId: string, readVersion: number, commit: ReviewCommit): Promise<boolean> {
    return commitReview(this.db, buildId, readVersion, commit);
  }
}
