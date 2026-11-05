import type { CheckRunState, CheckRunTarget, GitHubClient } from '@targus/core';

/** A `GitHubClient` that records what it was asked and knows a fixed set of org members. */
export interface RecordingGitHub extends GitHubClient {
  readonly membershipChecks: { readonly org: string; readonly login: string }[];
  readonly updates: {
    readonly target: CheckRunTarget;
    readonly checkRunId: number;
    readonly state: CheckRunState;
  }[];
}

export function createRecordingGitHub(
  members: readonly string[] = ['octocat'],
  options: { readonly failUpdates?: boolean } = {},
): RecordingGitHub {
  const membershipChecks: RecordingGitHub['membershipChecks'] = [];
  const updates: RecordingGitHub['updates'] = [];
  return {
    membershipChecks,
    updates,
    createCheckRun: () => Promise.resolve({ id: 901 }),
    updateCheckRun(target, checkRunId, state) {
      if (options.failUpdates === true) return Promise.reject(new Error('GitHub is down'));
      updates.push({ target, checkRunId, state });
      return Promise.resolve();
    },
    isOrgMember(_installationId, org, login) {
      membershipChecks.push({ org, login });
      return Promise.resolve(members.includes(login));
    },
  };
}
