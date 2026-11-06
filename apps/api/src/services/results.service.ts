import {
  buildStatusFromTally,
  compareSnapshot,
  tallySnapshots,
  TargusError,
  type ApprovalPair,
  type Build,
  type CompareSnapshotInput,
  type StoryResult,
  type SubmitResultsRequest,
  type SubmitResultsResponse,
} from '@targus/core';

import { failureReason } from '../logging/request-log.ts';
import type { SnapshotRecord } from '../repositories/build.repository.ts';
import type { Project } from '../repositories/project.repository.ts';
import { baselineEntries, requireBuild } from './build.service.ts';
import { reportCheckRun } from './check-run.ts';
import type { ServiceDeps } from './deps.ts';

type ResultsDeps = Pick<
  ServiceDeps,
  'approvals' | 'builds' | 'clock' | 'config' | 'github' | 'ids' | 'images' | 'log'
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
 * One stored snapshot per result. The state and review are the server's (ADR 0016 trusts the
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
    title: result.title,
    name: result.name,
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
    title: null,
    name: null,
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
 * Every capture and diff a result names must be an image this project uploaded. Images are
 * shared between tenants, so without this a project could adopt another tenant's image by
 * naming its hash, and then read it back as its own.
 */
async function requireUploaded(
  deps: ResultsDeps,
  project: Project,
  results: readonly StoryResult[],
): Promise<void> {
  const named = results.flatMap((result) => [result.imageHash, result.diffHash]);
  const hashes = [...new Set(named.filter((hash) => hash !== null))];
  const [foreign] = await deps.images.notUploadedBy(project.id, hashes);
  if (foreign !== undefined) {
    throw new TargusError('bad_request', `image ${foreign} was not uploaded by this project`);
  }
}

/**
 * Remember the check run's id so reviews can move it along. Best effort, like creating it: the
 * results are stored and the build is complete, so failing here would only make the CLI retry
 * into a conflict.
 */
async function rememberCheckRun(deps: ResultsDeps, buildId: string, checkRunId: number) {
  try {
    await deps.builds.setCheckRunId(buildId, checkRunId);
  } catch (error) {
    deps.log.warn('check_run_id_not_stored', { reason: failureReason(error) });
  }
}

/**
 * `POST /api/builds/:id/results`: classify every story against the baseline and the project's
 * approvals, store the snapshots and the folded build status in one write, then create the
 * check run. The write applies only while the build is `in_progress`, so a retry or a racing
 * second submission is a `conflict`, never a half-stored build.
 */
export async function submitResults(
  deps: ResultsDeps,
  project: Project,
  buildId: string,
  request: SubmitResultsRequest,
): Promise<SubmitResultsResponse> {
  const build = await requireBuild(deps, project, buildId);
  const alreadyDone = () => new TargusError('conflict', `build ${buildId} already has results`);
  if (build.status !== 'in_progress') throw alreadyDone();
  await requireUploaded(deps, project, request.results);
  const records = classify(
    deps,
    build.id,
    request.results,
    await loadComparison(deps, project, build),
  );
  const tally = tallySnapshots(records);
  const summary = buildStatusFromTally(tally);
  const completion = { status: summary.status, tally, completedAt: deps.clock.now() };
  if (!(await deps.builds.completeWithResults(build.id, records, completion))) throw alreadyDone();

  const reviewUrl = `${deps.config.publicUrl}/builds/${build.id}`;
  const checkRun = await reportCheckRun(deps, project, build, summary, reviewUrl);
  if (checkRun !== null) await rememberCheckRun(deps, build.id, checkRun.id);
  return { build: { id: build.id, number: build.number }, summary, reviewUrl, checkRun };
}
