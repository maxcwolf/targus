import type { CheckRunState, CheckRunTarget, GitHubClient } from '@targus/core';

import { isMemberOf, type OrgMembers } from './org-members.js';

/**
 * A `GitHubClient` that records what it was asked and knows a fixed set of org members, per org
 * (see `OrgMembers`).
 */
export interface RecordingGitHub extends GitHubClient {
  readonly membershipChecks: { readonly org: string; readonly login: string }[];
  readonly updates: {
    readonly target: CheckRunTarget;
    readonly checkRunId: number;
    readonly state: CheckRunState;
  }[];
}

export function createRecordingGitHub(
  members: OrgMembers = ['octocat'],
  options: {
    readonly failUpdates?: boolean;
    /**
     * Each org's App installation. When an org is listed here, a membership check through any
     * other installation answers false, as GitHub only lets an installation see its own org.
     */
    readonly installations?: Readonly<Record<string, number>>;
  } = {},
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
    isOrgMember(installationId, org, login) {
      membershipChecks.push({ org, login });
      const installation = options.installations?.[org];
      const reachable = installation === undefined || installation === installationId;
      return Promise.resolve(reachable && isMemberOf(members, org, login));
    },
  };
}
