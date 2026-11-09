import {
  buildStatusFromTally,
  checkRunName,
  tallySnapshots,
  type Build,
  type BuildStatusSummary,
  type CheckRunMissing,
  type CheckRunState,
  type CheckRunTarget,
} from '@targus/core';

import { failureReason } from '../logging/request-log.ts';
import type { Project } from '../repositories/project.repository.ts';
import type { ServiceDeps } from './deps.ts';

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function completedSummary(summary: BuildStatusSummary): string {
  if (summary.errorCount > 0) {
    return `${count(summary.errorCount, 'story', 'stories')} failed to render`;
  }
  if (summary.deniedCount > 0) return `${count(summary.deniedCount, 'change', 'changes')} denied`;
  return summary.status === 'accepted' ? 'All visual changes approved' : 'No visual changes';
}

/**
 * The check run for a build summary (plan.md section 5.2): `in_progress` with "N changes
 * awaiting review" while pending, else completed with the summary's conclusion.
 */
export function checkRunState(summary: BuildStatusSummary): CheckRunState {
  if (summary.conclusion === null) {
    const pending = count(summary.pendingCount, 'change', 'changes');
    return { status: 'in_progress', summary: `${pending} awaiting review` };
  }
  return {
    status: 'completed',
    conclusion: summary.conclusion,
    summary: completedSummary(summary),
  };
}

/** What `createCheckRun` left the build with: a check run, or why it has none. */
export type CheckRunOutcome = { readonly id: number } | { readonly missing: CheckRunMissing };

type CheckRunDeps = Pick<ServiceDeps, 'builds' | 'clock' | 'config' | 'github' | 'log'>;

/** How long a claim on creating a check run holds before another request may take it over. */
const claimLifetimeMs = 5 * 60_000;

/** Where a build is reviewed, which is also where its check on a pull request links. */
export function reviewUrlOf(deps: Pick<ServiceDeps, 'config'>, buildId: string): string {
  return `${deps.config.publicUrl}/builds/${buildId}`;
}

/** Run a best-effort call, logging `event` and answering null instead of throwing. */
async function bestEffort<T>(
  deps: Pick<ServiceDeps, 'log'>,
  event: string,
  call: () => Promise<T>,
): Promise<T | null> {
  try {
    return await call();
  } catch (error) {
    deps.log.warn(event, { reason: failureReason(error) });
    return null;
  }
}

function targetOf(installationId: number, project: Project, build: Build): CheckRunTarget {
  return { installationId, repo: project.repo, headSha: build.sha };
}

/** Ask GitHub for the check run: its id, 0 from the no-op client, or null when GitHub failed. */
function requestCheckRun(
  deps: CheckRunDeps,
  installationId: number,
  project: Project,
  build: Build,
  summary: BuildStatusSummary,
): Promise<number | null> {
  return bestEffort(deps, 'check_run_create_failed', async () => {
    const target = targetOf(installationId, project, build);
    const name = checkRunName(build.platform);
    const url = reviewUrlOf(deps, build.id);
    return (await deps.github.createCheckRun(target, name, checkRunState(summary), url)).id;
  });
}

/**
 * Create the build's check run in the state of `summary` and store its id, when its org has a
 * GitHub App installation. Two requests that both find the build without one (the results and
 * a review, or two reviews) do not both create one: the creation is claimed first, and the
 * request that loses the claim leaves it to the winner with the outcome `pending` (the build
 * may also have got its check run since it was read). Best effort throughout, since the
 * results or the review are already stored: a GitHub or D1 failure is logged, the claim is
 * released, and the outcome is `failed`, so the next review tries again.
 */
export async function createCheckRun(
  deps: CheckRunDeps,
  project: Project,
  build: Build,
  summary: BuildStatusSummary,
): Promise<CheckRunOutcome> {
  const installationId = project.org.installationId;
  if (installationId === null) return { missing: 'no_installation' };
  const claimedAt = deps.clock.now();
  const staleBefore = new Date(claimedAt.getTime() - claimLifetimeMs);
  const claimed = await bestEffort(deps, 'check_run_claim_failed', () =>
    deps.builds.claimCheckRun(build.id, claimedAt, staleBefore),
  );
  if (claimed === null) return { missing: 'failed' };
  if (!claimed) return { missing: 'pending' };
  const id = await requestCheckRun(deps, installationId, project, build, summary);
  if (id !== null && id > 0) {
    await bestEffort(deps, 'check_run_id_not_stored', () =>
      deps.builds.setCheckRunId(build.id, id),
    );
    return { id };
  }
  await bestEffort(deps, 'check_run_claim_not_released', () =>
    deps.builds.releaseCheckRunClaim(build.id, claimedAt),
  );
  return { missing: id === null ? 'failed' : 'no_github_app' };
}

/** A build's summary as of one review version. */
export interface ReviewedSummary {
  /** The build's `review_version` once the review that produced `summary` committed. */
  readonly version: number;
  readonly summary: BuildStatusSummary;
}

/** How many updates one sync sends at most, the first included, while newer reviews commit. */
const syncAttempts = 5;

/** Send `state` for the build's check; false, with a warning, when GitHub fails. */
async function sendUpdate(
  deps: CheckRunDeps,
  target: CheckRunTarget,
  build: Build,
  state: CheckRunState,
): Promise<boolean> {
  const sent = await bestEffort(deps, 'check_run_update_failed', async () => {
    const name = checkRunName(build.platform);
    await deps.github.updateCheckRun(target, name, state, reviewUrlOf(deps, build.id));
    return true;
  });
  return sent === true;
}

/**
 * Give a build that had no check run one in the state of `summary`, and answer its id, or null
 * when it still has none. When another request created it first, the build is read again and
 * the stored check run is updated here, since its creator may have looked for newer reviews
 * before this one committed. One still being created is left to the claim holder, which looks
 * for newer reviews after storing it.
 */
async function ensureCheckRun(
  deps: CheckRunDeps,
  target: CheckRunTarget,
  project: Project,
  build: Build,
  summary: BuildStatusSummary,
): Promise<number | null> {
  const outcome = await createCheckRun(deps, project, build, summary);
  if ('id' in outcome) return outcome.id;
  const stored = await bestEffort(deps, 'check_run_reread_failed', () =>
    deps.builds.findAnyById(build.id),
  );
  const checkRunId = stored?.checkRunId ?? null;
  if (checkRunId === null) return null;
  return (await sendUpdate(deps, target, build, checkRunState(summary))) ? checkRunId : null;
}

/**
 * After the check run was set to `sent`: while a newer review has committed, send the newest
 * summary again. Two reviews close together can finish their GitHub calls in either order
 * (ADR 0026); the last call to finish is always followed by this check, so the check run ends
 * on the state of the last review. Also run after the results create the check run (version 0).
 */
export async function followNewerReviews(
  deps: CheckRunDeps,
  project: Project,
  build: Build,
  sent: ReviewedSummary,
): Promise<void> {
  const installationId = project.org.installationId;
  if (installationId === null) return;
  const target = targetOf(installationId, project, build);
  let current = sent;
  for (let sends = 1; ; sends += 1) {
    const latest = await deps.builds.readForReview(build.id);
    if (latest.version <= current.version) return;
    if (sends === syncAttempts) break;
    const summary = buildStatusFromTally(tallySnapshots(latest.snapshots));
    current = { version: latest.version, summary };
    if (!(await sendUpdate(deps, target, build, checkRunState(summary)))) return;
  }
  deps.log.warn('check_run_update_superseded', { attempts: syncAttempts });
}

/** Set the build's check run to `summary`, creating it when missing; its id, or null if none. */
async function setCheckRun(
  deps: CheckRunDeps,
  target: CheckRunTarget,
  project: Project,
  build: Build,
  summary: BuildStatusSummary,
): Promise<number | null> {
  const { checkRunId } = build;
  if (checkRunId === null) return ensureCheckRun(deps, target, project, build, summary);
  return (await sendUpdate(deps, target, build, checkRunState(summary))) ? checkRunId : null;
}

/**
 * Move the build's check run to the state of a review's summary, creating it first when the
 * build has none yet (creating it failed when the results came in), then resend while newer
 * reviews have committed (`followNewerReviews`). Skipped when the org has no installation;
 * best effort, like `createCheckRun`: the review is already stored, so a GitHub outage only
 * leaves the check run stale or missing until the next review.
 */
export async function syncCheckRun(
  deps: CheckRunDeps,
  project: Project,
  build: Build,
  reviewed: ReviewedSummary,
): Promise<void> {
  const installationId = project.org.installationId;
  if (installationId === null) return;
  const target = targetOf(installationId, project, build);
  const checkRunId = await setCheckRun(deps, target, project, build, reviewed.summary);
  if (checkRunId === null) return;
  await followNewerReviews(deps, project, build, reviewed);
}
