import {
  acceptedImageHash,
  baselineShaOrder,
  buildStatusFromTally,
  emptyTally,
  TargusError,
  type BaselineEntry,
  type Build,
  type BuildStatusSummary,
  type BuildWithSummary,
  type CreateBuildRequest,
  type CreateBuildResponse,
  type GetBuildResponse,
  type ListBuildsResponse,
  type ListSnapshotsResponse,
  type Snapshot,
} from '@targus/core';

import type { BuildRecord, SnapshotRecord } from '../repositories/build.repository.js';
import type { Project } from '../repositories/project.repository.js';
import { requireBuildAccess, requireProjectAccess } from './access.service.js';
import type { ServiceDeps } from './deps.js';
import type { Principal, Reviewer } from './principal.js';

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
): Promise<BuildRecord> {
  const build = await deps.builds.findById(project.id, buildId);
  if (build === null) throw new TargusError('not_found', `no build ${buildId}`);
  return build;
}

/**
 * `POST /api/builds`: open a build. Resolves the baseline (plan.md section 6, rule 1), returns
 * its accepted images and the hashes the CLI still has to upload, and stores the build as
 * `in_progress` until results arrive. "Still has to upload" is per project: an image only
 * another tenant sent is asked for again, so the answer never says what other tenants hold.
 */
export async function createBuild(
  deps: Pick<ServiceDeps, 'builds' | 'clock' | 'ids' | 'images'>,
  project: Project,
  request: CreateBuildRequest,
): Promise<CreateBuildResponse> {
  const shas = baselineShaOrder(request.mergeBaseSha, request.ancestors);
  const baseline = await deps.builds.findLatestSuccessfulForShas(project.id, shas);
  const baselines =
    baseline === null ? [] : baselineEntries(await deps.builds.listSnapshots(baseline.id));

  const hashes = [...new Set(request.snapshots.map((snapshot) => snapshot.imageHash))];
  const missing = await deps.images.notUploadedBy(project.id, hashes);
  const now = deps.clock.now();
  const present = hashes.filter((hash) => !missing.includes(hash));
  await deps.images.touch([...present, ...baselines.map((entry) => entry.imageHash)], now);

  const build = await deps.builds.create(
    {
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
    },
    emptyTally,
  );
  return {
    build: { id: build.id, number: build.number },
    baselineBuildId: build.baselineBuildId,
    baselines,
    missingImageHashes: missing,
  };
}

/** The max builds `GET /api/projects/:id/builds` returns by default. */
const defaultBuildsLimit = 50;

/**
 * The summary of a build, from its stored tally. While it is `in_progress` there is nothing to
 * fold yet, so it says so, with no conclusion and every count 0.
 */
function summarize(build: BuildRecord): BuildStatusSummary {
  if (build.status === 'in_progress') {
    return {
      status: 'in_progress',
      conclusion: null,
      pendingCount: 0,
      deniedCount: 0,
      errorCount: 0,
    };
  }
  return buildStatusFromTally(build.tally);
}

/** The wire `Build`, without the storage-only tally. */
function toWireBuild(record: BuildRecord): Build {
  return {
    id: record.id,
    projectId: record.projectId,
    number: record.number,
    sha: record.sha,
    branch: record.branch,
    prNumber: record.prNumber,
    mergeBaseSha: record.mergeBaseSha,
    baselineBuildId: record.baselineBuildId,
    trigger: record.trigger,
    device: record.device,
    status: record.status,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    checkRunId: record.checkRunId,
  };
}

/** A build as the API returns it: the build, its status summary and its snapshot counts. */
export function withSummary(build: BuildRecord): BuildWithSummary {
  return { build: toWireBuild(build), summary: summarize(build), counts: build.tally.counts };
}

/** The wire form of a stored snapshot, without the storage-only `blank` and `error`. */
export function toSnapshot(record: SnapshotRecord): Snapshot {
  return {
    id: record.id,
    buildId: record.buildId,
    storyId: record.storyId,
    variant: record.variant,
    title: record.title,
    name: record.name,
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

type ReadDeps = Pick<ServiceDeps, 'builds' | 'clock' | 'github' | 'memberships' | 'projects'>;

/** `GET /api/builds/:id`, for the CLI's project token or a reviewer of the project's org. */
export async function getBuild(
  deps: ReadDeps,
  principal: Principal,
  buildId: string,
): Promise<GetBuildResponse> {
  const { build } = await requireBuildAccess(deps, principal, buildId);
  return withSummary(build);
}

/** `GET /api/builds/:id/snapshots`. */
export async function listSnapshots(
  deps: ReadDeps,
  principal: Principal,
  buildId: string,
): Promise<ListSnapshotsResponse> {
  const { build } = await requireBuildAccess(deps, principal, buildId);
  const records = await deps.builds.listSnapshots(build.id);
  return { snapshots: records.map(toSnapshot) };
}

/** `GET /api/projects/:id/builds`: the newest builds first, each with its summary. */
export async function listBuilds(
  deps: ReadDeps,
  reviewer: Reviewer,
  projectId: string,
  limit: number = defaultBuildsLimit,
): Promise<ListBuildsResponse> {
  const project = await deps.projects.findById(projectId);
  if (project === null) throw new TargusError('not_found', `no project ${projectId}`);
  await requireProjectAccess(deps, { kind: 'reviewer', reviewer }, project);
  const builds = await deps.builds.listForProject(project.id, limit);
  return { builds: builds.map(withSummary) };
}
