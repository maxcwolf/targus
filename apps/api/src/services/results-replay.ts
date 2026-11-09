import {
  buildStatusFromTally,
  tallySnapshots,
  TargusError,
  type Build,
  type SubmitResultsRequest,
  type SubmitResultsResponse,
} from '@targus/core';

import { sha256Hex } from '../lib/sha256.ts';
import type { Project } from '../repositories/project.repository.ts';
import {
  createCheckRun,
  followNewerReviews,
  reviewUrlOf,
  type ReviewedSummary,
} from './check-run.ts';
import type { ServiceDeps } from './deps.ts';

type ReplayDeps = Pick<ServiceDeps, 'builds' | 'clock' | 'config' | 'github' | 'log'>;

type CheckRunPart = Pick<SubmitResultsResponse, 'checkRun' | 'checkRunMissing'>;

/**
 * What tells a resend of a results submission from other results (ADR 0031): the SHA-256 of
 * the validated request as JSON. The schema fixes the key order, and the CLI resends the body
 * it sent first, so every attempt of one submission has the same digest.
 */
export function resultsDigest(request: SubmitResultsRequest): Promise<string> {
  return sha256Hex(JSON.stringify(request));
}

function storedCheckRun(checkRunId: number | null): CheckRunPart | null {
  return checkRunId === null ? null : { checkRun: { id: checkRunId }, checkRunMissing: null };
}

/**
 * The check run of a replayed submission. A build that has none yet (creating it failed when
 * the results first came in) gets one now, in the state of `reviewed`, and the newer reviews
 * are followed as after any late creation (ADR 0026). When another request holds the claim on
 * creating it, as the first attempt does while it waits on GitHub, the build is read once more:
 * the check run it stored since is answered, and one still being created is left to its
 * creator, which follows the newer reviews itself, with `pending`.
 */
async function replayCheckRun(
  deps: ReplayDeps,
  project: Project,
  build: Build,
  reviewed: ReviewedSummary,
): Promise<CheckRunPart> {
  const stored = storedCheckRun(build.checkRunId);
  if (stored !== null) return stored;
  const outcome = await createCheckRun(deps, project, build, reviewed.summary);
  if ('id' in outcome) {
    await followNewerReviews(deps, project, build, reviewed);
    return { checkRun: { id: outcome.id }, checkRunMissing: null };
  }
  if (outcome.missing !== 'pending') return { checkRun: null, checkRunMissing: outcome.missing };
  const reread = await deps.builds.findAnyById(build.id);
  return (
    storedCheckRun(reread?.checkRunId ?? null) ?? { checkRun: null, checkRunMissing: 'pending' }
  );
}

/**
 * Answer a submission for a build that already has results. The same request as the one that
 * completed it (a retry after a lost response) answers as that one did, with the build's
 * summary as of now, since a review may have decided some changes since. Any other request is
 * a `conflict`, and so is every request for a build completed before digests were stored.
 */
export async function replayResults(
  deps: ReplayDeps,
  project: Project,
  build: Build,
  digest: string,
): Promise<SubmitResultsResponse> {
  if ((await deps.builds.findResultsDigest(build.id)) !== digest) {
    throw new TargusError('conflict', `build ${build.id} already has other results`);
  }
  const latest = await deps.builds.readForReview(build.id);
  const summary = buildStatusFromTally(tallySnapshots(latest.snapshots));
  const checkRun = await replayCheckRun(deps, project, build, {
    version: latest.version,
    summary,
  });
  return {
    build: { id: build.id, number: build.number },
    summary,
    reviewUrl: reviewUrlOf(deps, build.id),
    ...checkRun,
  };
}
