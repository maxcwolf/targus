import type { Build, BuildStatusSummary, CheckRunMissing, CheckRunState } from '@targus/core';

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

/** Where a build is reviewed, which is also its check run's details link. */
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

/** Ask GitHub for the check run: its id, 0 from the no-op client, or null when GitHub failed. */
function requestCheckRun(
  deps: CheckRunDeps,
  installationId: number,
  project: Project,
  build: Build,
  summary: BuildStatusSummary,
): Promise<number | null> {
  return bestEffort(deps, 'check_run_create_failed', async () => {
    const target = { installationId, repo: project.repo, headSha: build.sha };
    const url = reviewUrlOf(deps, build.id);
    return (await deps.github.createCheckRun(target, checkRunState(summary), url)).id;
  });
}

/**
 * Create the build's check run in the state of `summary` and store its id, when its org has a
 * GitHub App installation. Two requests that both find the build without one (the results and
 * a review, or two reviews) do not both create one: the creation is claimed first, and the
 * request that loses the claim leaves it to the winner. Best effort throughout, since the
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
  if (claimed !== true) return { missing: 'failed' };
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

/**
 * Move the build's check run to the state of its new summary after a review, creating it first
 * when the build has none yet (creating it failed when the results came in). Skipped when the
 * org has no installation; best effort, like `createCheckRun`: the review is already stored, so
 * a GitHub outage only leaves the check run stale or missing until the next review.
 */
export async function syncCheckRun(
  deps: CheckRunDeps,
  project: Project,
  build: Build,
  summary: BuildStatusSummary,
): Promise<void> {
  const installationId = project.org.installationId;
  if (installationId === null) return;
  const { checkRunId } = build;
  if (checkRunId === null) {
    await createCheckRun(deps, project, build, summary);
    return;
  }
  const target = { installationId, repo: project.repo, headSha: build.sha };
  await bestEffort(deps, 'check_run_update_failed', () =>
    deps.github.updateCheckRun(target, checkRunId, checkRunState(summary)),
  );
}
