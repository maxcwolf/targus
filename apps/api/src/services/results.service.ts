import {
  buildStatus,
  compareSnapshot,
  TargusError,
  type ApprovalPair,
  type Build,
  type CompareSnapshotInput,
  type StoryResult,
  type SubmitResultsRequest,
  type SubmitResultsResponse,
} from '@targus/core';

import type { SnapshotRecord } from '../repositories/build.repository.js';
import type { Project } from '../repositories/project.repository.js';
import { baselineEntries, requireBuild } from './build.service.js';
import { reportCheckRun } from './check-run.js';
import type { ServiceDeps } from './deps.js';

type ResultsDeps = Pick<
  ServiceDeps,
  'approvals' | 'builds' | 'clock' | 'config' | 'github' | 'ids'
>;

/** What every story of the build is compared against. */
interface Comparison {
  /** Accepted image of each baseline story, by `storyKey`. */
  readonly baselines: ReadonlyMap<string, string>;
  /** Approvals of each story, by `storyKey`. */
  readonly approvals: ReadonlyMap<string, ApprovalPair[]>;
  readonly threshold: number;
}

const storyKey = (storyId: string, variant: string): string => `${storyId}\u0000${variant}`;

async function loadComparison(
  deps: ResultsDeps,
  project: Project,
  build: Build,
): Promise<Comparison> {
  const baselineSnapshots =
    build.baselineBuildId === null ? [] : await deps.builds.listSnapshots(build.baselineBuildId);
  const baselines = new Map(
    baselineEntries(baselineSnapshots).map((entry) => [
      storyKey(entry.storyId, entry.variant),
      entry.imageHash,
    ]),
  );
  const approvals = new Map<string, ApprovalPair[]>();
  for (const approval of await deps.approvals.listForProject(project.id)) {
    const key = storyKey(approval.storyId, approval.variant);
    approvals.set(key, [...(approvals.get(key) ?? []), approval]);
  }
  return { baselines, approvals, threshold: deps.config.diffThreshold };
}

/** The capture as `compareSnapshot` sees it. An errored story has no image, so its hash is null. */
function currentOf(result: StoryResult): CompareSnapshotInput['current'] {
  if (result.error !== null) return { imageHash: null, unstable: false, error: result.error };
  if (result.imageHash === null) return null;
  return { imageHash: result.imageHash, unstable: result.state === 'unstable', error: null };
}

/**
 * One stored snapshot per result. The state and review are the server's (ADR 0003 trusts the
 * CLI's diff ratio, not its classification), so a disagreeing CLI `state` is overwritten.
 */
function recordFor(
  deps: ResultsDeps,
  buildId: string,
  result: StoryResult,
  comparison: Comparison,
): SnapshotRecord {
  const key = storyKey(result.storyId, result.variant);
  const baselineHash = comparison.baselines.get(key) ?? null;
  const outcome = compareSnapshot({
    current: currentOf(result),
    baseline: baselineHash === null ? null : { imageHash: baselineHash },
    diffRatio: result.diffRatio,
    threshold: comparison.threshold,
    approvals: comparison.approvals.get(key) ?? [],
  });
  return {
    id: deps.ids.next(),
    buildId,
    storyId: result.storyId,
    variant: result.variant,
    imageHash: result.imageHash,
    width: result.width,
    height: result.height,
    baselineHash,
    diffHash: result.diffHash,
    diffRatio: result.diffRatio,
    state: outcome.state,
    review: outcome.review,
    reviewedBy: null,
    reviewedAt: null,
    blank: result.blank,
    error: result.error,
  };
}

/** A baseline story this build did not report (plan.md section 6, rule 2). */
function removedRecord(
  deps: ResultsDeps,
  buildId: string,
  key: string,
  baselineHash: string,
): SnapshotRecord {
  const [storyId = '', variant = ''] = key.split('\u0000');
  return {
    ...compareSnapshot({
      current: null,
      baseline: { imageHash: baselineHash },
      diffRatio: null,
      threshold: 0,
      approvals: [],
    }),
    id: deps.ids.next(),
    buildId,
    storyId,
    variant,
    imageHash: null,
    width: null,
    height: null,
    baselineHash,
    diffHash: null,
    diffRatio: null,
    reviewedBy: null,
    reviewedAt: null,
    blank: false,
    error: null,
  };
}

function classify(
  deps: ResultsDeps,
  buildId: string,
  results: readonly StoryResult[],
  comparison: Comparison,
): SnapshotRecord[] {
  const seen = new Set<string>();
  const records = results.map((result) => {
    const key = storyKey(result.storyId, result.variant);
    if (seen.has(key)) {
      throw new TargusError(
        'bad_request',
        `duplicate result for ${result.storyId} (${result.variant})`,
      );
    }
    seen.add(key);
    return recordFor(deps, buildId, result, comparison);
  });
  const removed = [...comparison.baselines]
    .filter(([key]) => !seen.has(key))
    .map(([key, hash]) => removedRecord(deps, buildId, key, hash));
  return [...records, ...removed];
}

/**
 * `POST /api/builds/:id/results`: classify every story against the baseline and the project's
 * approvals, store the snapshots, fold the build status, and create the check run.
 */
export async function submitResults(
  deps: ResultsDeps,
  project: Project,
  buildId: string,
  request: SubmitResultsRequest,
): Promise<SubmitResultsResponse> {
  const build = await requireBuild(deps, project, buildId);
  if (build.status !== 'in_progress') {
    throw new TargusError('conflict', `build ${buildId} already has results`);
  }
  const records = classify(
    deps,
    build.id,
    request.results,
    await loadComparison(deps, project, build),
  );
  await deps.builds.saveSnapshots(build.id, records);

  const summary = buildStatus(records);
  const reviewUrl = `${deps.config.publicUrl}/builds/${build.id}`;
  const checkRun = await reportCheckRun(deps, project, build, summary, reviewUrl);
  await deps.builds.updateStatus(build.id, summary.status, deps.clock.now(), checkRun?.id ?? null);
  return { build: { id: build.id, number: build.number }, summary, reviewUrl, checkRun };
}
