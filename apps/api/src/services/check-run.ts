import type { Build, BuildStatusSummary, CheckRunState } from '@targus/core';

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

/**
 * Create the build's check run when its org has a GitHub App installation. Returns null when
 * there is none, when the client is the no-op one (id 0), or when GitHub fails: the results are
 * already stored, so a GitHub outage must not lose them.
 */
export async function reportCheckRun(
  deps: Pick<ServiceDeps, 'github' | 'log'>,
  project: Project,
  build: Build,
  summary: BuildStatusSummary,
  detailsUrl: string,
): Promise<{ id: number } | null> {
  const installationId = project.org.installationId;
  if (installationId === null) return null;
  try {
    const { id } = await deps.github.createCheckRun(
      { installationId, repo: project.repo, headSha: build.sha },
      checkRunState(summary),
      detailsUrl,
    );
    return id > 0 ? { id } : null;
  } catch (error) {
    deps.log.warn('check_run_create_failed', { reason: failureReason(error) });
    return null;
  }
}

/**
 * Move the build's check run to the state of its new summary after a review. Skipped when the
 * build has no check run or its org no installation; best effort, like `reportCheckRun`: the
 * review is already stored, so a GitHub outage only leaves the check run stale.
 */
export async function syncCheckRun(
  deps: Pick<ServiceDeps, 'github' | 'log'>,
  project: Project,
  build: Build,
  summary: BuildStatusSummary,
): Promise<void> {
  const installationId = project.org.installationId;
  if (build.checkRunId === null || installationId === null) return;
  try {
    await deps.github.updateCheckRun(
      { installationId, repo: project.repo, headSha: build.sha },
      build.checkRunId,
      checkRunState(summary),
    );
  } catch (error) {
    deps.log.warn('check_run_update_failed', { reason: failureReason(error) });
  }
}
