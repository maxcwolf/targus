import { baselineBuildStatuses, emptyTally, resolveBaseline } from '@targus/core';

import type {
  ApiBuildRepository,
  BuildRecord,
  SnapshotRecord,
} from '../../src/repositories/build.repository.ts';
import {
  checkBuildPageLimit,
  decodeBuildCursor,
  toBuildPage,
} from '../../src/repositories/build-page.ts';
import type { ProjectRepository } from '../../src/repositories/project.repository.ts';
import { compareText, foreignKeyViolation, uniqueViolation } from './d1-semantics.ts';
import { createInMemoryApprovals, type InMemoryApprovals } from './in-memory-approvals.ts';

// The in-memory double of the builds repository, for service unit tests. It and the D1 adapter
// run the same contract suites (test/support/contracts/build*.contract.ts). Each write checks
// its guard and applies with no await in between, as one D1 transaction would. A build names a
// project of the projects double it is given, as D1's foreign key on project_id requires.

export interface InMemoryBuilds extends ApiBuildRepository {
  readonly builds: BuildRecord[];
  readonly snapshots: Map<string, SnapshotRecord[]>;
  /** `review_version` of each build that has been reviewed; absent means 0. */
  readonly versions: Map<string, number>;
}

/** The project-wide build reads of the builds double. */
function buildQueries(
  builds: readonly BuildRecord[],
): Pick<
  ApiBuildRepository,
  'listForProject' | 'findLatestBaselineOnBranch' | 'findLatestSuccessfulForShas'
> {
  const newestFirst = (projectId: string): BuildRecord[] =>
    builds.filter((b) => b.projectId === projectId).sort((a, b) => b.number - a.number);
  return {
    // As the D1 query: validate first, then `number < cursor`, newest first, one extra build.
    // A rejected promise, not a throw, for a bad limit or cursor, as the D1 adapter's.
    listForProject: (projectId, { limit, cursor }) =>
      Promise.resolve().then(() => {
        const checked = checkBuildPageLimit(limit);
        const before = cursor === undefined ? Infinity : decodeBuildCursor(cursor);
        const older = newestFirst(projectId).filter((b) => b.number < before);
        return toBuildPage(older.slice(0, checked + 1), checked);
      }),
    findLatestBaselineOnBranch: (projectId, branch) =>
      Promise.resolve(
        newestFirst(projectId)
          .filter((b) => b.branch === branch)
          .find((b) => baselineBuildStatuses.some((status) => status === b.status)) ?? null,
      ),
    findLatestSuccessfulForShas: (projectId, shas) =>
      Promise.resolve(
        resolveBaseline(
          shas,
          builds.filter((b) => b.projectId === projectId),
        ),
      ),
  };
}

/** A build's snapshots as D1 lists them: by story, then variant. */
const storyOrder = (records: readonly SnapshotRecord[]): SnapshotRecord[] =>
  [...records].sort(
    (a, b) => compareText(a.storyId, b.storyId) || compareText(a.variant, b.variant),
  );

/**
 * What D1 would reject in `records` for `buildId`, if anything: a story and variant twice
 * (`snapshots_build_story_variant_unique`), or a snapshot id twice or already used by another
 * build's snapshot (the primary key). The build's own snapshots are cleared first, as in D1.
 */
function rejectedSnapshot(
  snapshots: ReadonlyMap<string, readonly SnapshotRecord[]>,
  buildId: string,
  records: readonly SnapshotRecord[],
): string | null {
  const stories = new Set(records.map((record) => `${record.storyId}\u0000${record.variant}`));
  if (stories.size !== records.length) return 'snapshots.build_id, snapshots.story_id, ...';
  const others = [...snapshots].filter(([id]) => id !== buildId).flatMap(([, stored]) => stored);
  const ids = new Set([...records, ...others].map((record) => record.id));
  return ids.size === records.length + others.length ? null : 'snapshots.id';
}

type Patch = (buildId: string, fields: Partial<BuildRecord>) => void;

/** The state the snapshot-review half shares with the rest of the builds double. */
interface ReviewState {
  readonly builds: readonly BuildRecord[];
  readonly snapshots: Map<string, SnapshotRecord[]>;
  readonly versions: Map<string, number>;
  readonly patch: Patch;
  readonly approvals: InMemoryApprovals;
}

/** The snapshot-review half of the builds double; a review's approvals go to `approvals`. */
function snapshotReviews({
  builds,
  snapshots,
  versions,
  patch,
  approvals,
}: ReviewState): Pick<ApiBuildRepository, 'findSnapshotById' | 'readForReview' | 'commitReview'> {
  return {
    findSnapshotById: (snapshotId) =>
      Promise.resolve(
        [...snapshots.values()].flat().find((snapshot) => snapshot.id === snapshotId) ?? null,
      ),
    readForReview: (buildId) =>
      Promise.resolve({
        version: versions.get(buildId) ?? 0,
        snapshots: storyOrder(snapshots.get(buildId) ?? []),
      }),
    commitReview(buildId, readVersion, commit) {
      const version = versions.get(buildId) ?? 0;
      // No build row, no update: D1's guarded UPDATE matches nothing.
      const exists = builds.some((b) => b.id === buildId);
      if (!exists || version !== readVersion) return Promise.resolve(false);
      const { snapshotIds, review, reviewedBy, reviewedAt, status, tally } = commit;
      const ids = new Set(snapshotIds);
      const decided = { review, reviewedBy, reviewedAt: reviewedAt.toISOString() };
      snapshots.set(
        buildId,
        (snapshots.get(buildId) ?? []).map((s) => (ids.has(s.id) ? { ...s, ...decided } : s)),
      );
      commit.approvals.withdraw.forEach((pair) => {
        approvals.withdraw(pair);
      });
      commit.approvals.record.forEach(({ id, approval }) => {
        approvals.record(id, approval);
      });
      patch(buildId, { status, tally });
      versions.set(buildId, version + 1);
      return Promise.resolve(true);
    },
  };
}

/**
 * The check run id and the claims on creating one. A claim is kept apart from the record, which
 * reads as no check run while it is held, as D1's does.
 */
function checkRunClaims(
  builds: readonly BuildRecord[],
  patch: Patch,
): Pick<ApiBuildRepository, 'setCheckRunId' | 'claimCheckRun' | 'releaseCheckRunClaim'> {
  const claims = new Map<string, number>();
  return {
    setCheckRunId(buildId, checkRunId) {
      claims.delete(buildId);
      patch(buildId, { checkRunId });
      return Promise.resolve();
    },
    claimCheckRun(buildId, claimedAt, staleBefore) {
      const build = builds.find((b) => b.id === buildId);
      const claim = claims.get(buildId);
      const held = claim !== undefined && claim >= staleBefore.getTime();
      if (build?.checkRunId !== null || held) return Promise.resolve(false);
      claims.set(buildId, claimedAt.getTime());
      return Promise.resolve(true);
    },
    releaseCheckRunClaim(buildId, claimedAt) {
      if (claims.get(buildId) === claimedAt.getTime()) claims.delete(buildId);
      return Promise.resolve();
    },
  };
}

/**
 * `create` of the builds double. The foreign key on project_id first, as D1 enforces it; then,
 * as the D1 upsert, a key the project already used returns its build, unchanged, before the id
 * is checked (`builds_project_idempotency_key_unique`). No await between the checks and the write.
 */
function createBuild(
  builds: BuildRecord[],
  projects: Pick<ProjectRepository, 'findById'>,
): ApiBuildRepository['create'] {
  const keys = new Map<string, string>();
  return async ({ idempotencyKey, ...build }, tally = emptyTally) => {
    if ((await projects.findById(build.projectId)) === null) {
      return foreignKeyViolation('builds.project_id');
    }
    const key = idempotencyKey == null ? null : `${build.projectId}\u0000${idempotencyKey}`;
    const replayed = key === null ? undefined : builds.find((b) => b.id === keys.get(key));
    if (replayed !== undefined) return replayed;
    if (builds.some((other) => other.id === build.id)) return uniqueViolation('builds.id');
    const number = builds.filter((other) => other.projectId === build.projectId).length + 1;
    const created = { ...build, number, tally };
    builds.push(created);
    if (key !== null) keys.set(key, build.id);
    return created;
  };
}

/**
 * `projects` is the projects double whose rows builds name; `approvals` is the approvals double
 * a committed review records and withdraws approvals in.
 */
export function createInMemoryBuilds(
  projects: Pick<ProjectRepository, 'findById'>,
  approvals: InMemoryApprovals = createInMemoryApprovals(projects),
): InMemoryBuilds {
  const builds: BuildRecord[] = [];
  const snapshots = new Map<string, SnapshotRecord[]>();
  const versions = new Map<string, number>();
  const digests = new Map<string, string>();
  const find = (match: (build: BuildRecord) => boolean) =>
    Promise.resolve(builds.find(match) ?? null);
  const patch: Patch = (buildId, fields) => {
    const index = builds.findIndex((build) => build.id === buildId);
    const build = builds[index];
    if (build !== undefined) builds[index] = { ...build, ...fields };
  };
  return {
    builds,
    snapshots,
    versions,
    create: createBuild(builds, projects),
    findById: (projectId, buildId) => find((b) => b.projectId === projectId && b.id === buildId),
    findAnyById: (buildId) => find((b) => b.id === buildId),
    ...buildQueries(builds),
    completeWithResults(buildId, records, { status, tally, completedAt, resultsDigest }) {
      if (builds.find((b) => b.id === buildId)?.status !== 'in_progress') {
        return Promise.resolve(false);
      }
      // Checked before anything changes, so a rejected write leaves no trace, as in D1.
      const rejected = rejectedSnapshot(snapshots, buildId, records);
      if (rejected !== null) return uniqueViolation(rejected);
      snapshots.set(
        buildId,
        records.map((record) => ({ ...record, buildId })),
      );
      patch(buildId, { status, tally, completedAt: completedAt.toISOString() });
      digests.set(buildId, resultsDigest);
      return Promise.resolve(true);
    },
    findResultsDigest: (buildId) => Promise.resolve(digests.get(buildId) ?? null),
    ...checkRunClaims(builds, patch),
    listSnapshots: (buildId) => Promise.resolve(storyOrder(snapshots.get(buildId) ?? [])),
    ...snapshotReviews({ builds, snapshots, versions, patch, approvals }),
  };
}
