import type { CheckRunState, CheckRunTarget, GitHubClient } from '@targus/core';

import { defaultAccountId } from './github-stub.ts';
import { isMemberOf, type OrgMembers } from './org-members.ts';

/**
 * A `GitHubClient` that records what it was asked and knows a fixed set of org members, per org
 * (see `OrgMembers`).
 */
export interface RecordingGitHub extends GitHubClient {
  readonly membershipChecks: { readonly org: string; readonly login: string }[];
  /** The installation ids whose account was asked for, in order. */
  readonly accountLookups: number[];
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
    /**
     * The account id of each installation, by installation id: a personal account's installation
     * gets its owner's GitHub id. Others get `defaultAccountId`, an org no reviewer is.
     */
    readonly accounts?: Readonly<Record<number, number>>;
  } = {},
): RecordingGitHub {
  const membershipChecks: RecordingGitHub['membershipChecks'] = [];
  const accountLookups: number[] = [];
  const updates: RecordingGitHub['updates'] = [];
  return {
    membershipChecks,
    accountLookups,
    updates,
    installationAccountId(installationId) {
      accountLookups.push(installationId);
      return Promise.resolve(
        options.accounts?.[installationId] ?? defaultAccountId(installationId),
      );
    },
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
