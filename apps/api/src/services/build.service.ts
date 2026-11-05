import {
  acceptedImageHash,
  baselineShaOrder,
  buildStatus,
  TargusError,
  type BaselineEntry,
  type Build,
  type BuildStatusSummary,
  type CreateBuildRequest,
  type CreateBuildResponse,
  type GetBuildResponse,
  type ListSnapshotsResponse,
  type Snapshot,
} from '@targus/core';

import type { SnapshotRecord } from '../repositories/build.repository.js';
import type { Project } from '../repositories/project.repository.js';
import type { ServiceDeps } from './deps.js';

/** The accepted image of every story of a build (plan.md section 6, rule 5), skipping none. */
export function baselineEntries(snapshots: readonly Snapshot[]): BaselineEntry[] {
  return snapshots.flatMap((snapshot) => {
    const imageHash = acceptedImageHash(snapshot);
    return imageHash === null
      ? []
      : [{ storyId: snapshot.storyId, variant: snapshot.variant, imageHash }];
  });
}

/** Read a build of `project`, or `not_found` (also when it belongs to another project). */
export async function requireBuild(
  deps: Pick<ServiceDeps, 'builds'>,
  project: Project,
  buildId: string,
): Promise<Build> {
  const build = await deps.builds.findById(project.id, buildId);
  if (build === null) throw new TargusError('not_found', `no build ${buildId}`);
  return build;
}

/**
 * `POST /api/builds`: open a build. Resolves the baseline (plan.md section 6, rule 1), returns
 * its accepted images and the hashes the CLI still has to upload, and stores the build as
 * `in_progress` until results arrive.
 */
export async function createBuild(
  deps: Pick<ServiceDeps, 'builds' | 'clock' | 'ids' | 'images' | 'imageStore'>,
  project: Project,
  request: CreateBuildRequest,
): Promise<CreateBuildResponse> {
  const shas = baselineShaOrder(request.mergeBaseSha, request.ancestors);
  const baseline = await deps.builds.findLatestSuccessfulForShas(project.id, shas);
  const baselines =
    baseline === null ? [] : baselineEntries(await deps.builds.listSnapshots(baseline.id));

  const hashes = [...new Set(request.snapshots.map((snapshot) => snapshot.imageHash))];
  const missing = await deps.imageStore.missing(hashes);
  const now = deps.clock.now();
  const present = hashes.filter((hash) => !missing.includes(hash));
  await deps.images.touch([...present, ...baselines.map((entry) => entry.imageHash)], now);

  const build = await deps.builds.create({
    id: deps.ids.next(),
    projectId: project.id,
    sha: request.sha,
    branch: request.branch,
    prNumber: request.prNumber,
    mergeBaseSha: request.mergeBaseSha,
    baselineBuildId: baseline?.id ?? null,
    trigger: request.trigger,
    device: request.device,
    status: 'in_progress',
    createdAt: now.toISOString(),
    completedAt: null,
    checkRunId: null,
  });
  return {
    build: { id: build.id, number: build.number },
    baselineBuildId: build.baselineBuildId,
    baselines,
    missingImageHashes: missing,
  };
}

/**
 * The summary of a build. While it is `in_progress` there is nothing to fold yet, so it says so,
 * with no conclusion and every count 0.
 */
function summarize(build: Build, snapshots: readonly Snapshot[]): BuildStatusSummary {
  if (build.status === 'in_progress') {
    return {
      status: 'in_progress',
      conclusion: null,
      pendingCount: 0,
      deniedCount: 0,
      errorCount: 0,
    };
  }
  return buildStatus(snapshots);
}

/** The wire form of a stored snapshot, without the storage-only `blank` and `error`. */
export function toSnapshot(record: SnapshotRecord): Snapshot {
  return {
    id: record.id,
    buildId: record.buildId,
    storyId: record.storyId,
    variant: record.variant,
    imageHash: record.imageHash,
    width: record.width,
    height: record.height,
    baselineHash: record.baselineHash,
    diffHash: record.diffHash,
    diffRatio: record.diffRatio,
    state: record.state,
    review: record.review,
    reviewedBy: record.reviewedBy,
    reviewedAt: record.reviewedAt,
  };
}

/** `GET /api/builds/:id`. */
export async function getBuild(
  deps: Pick<ServiceDeps, 'builds'>,
  project: Project,
  buildId: string,
): Promise<GetBuildResponse> {
  const build = await requireBuild(deps, project, buildId);
  return { build, summary: summarize(build, await deps.builds.listSnapshots(build.id)) };
}

/** `GET /api/builds/:id/snapshots`. */
export async function listSnapshots(
  deps: Pick<ServiceDeps, 'builds'>,
  project: Project,
  buildId: string,
): Promise<ListSnapshotsResponse> {
  const build = await requireBuild(deps, project, buildId);
  const records = await deps.builds.listSnapshots(build.id);
  return { snapshots: records.map(toSnapshot) };
}
