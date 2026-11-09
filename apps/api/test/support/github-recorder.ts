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
  /** The checks (commit statuses) created, in order; each gets id 901, 902, ... */
  readonly creates: {
    readonly target: CheckRunTarget;
    readonly name: string;
    readonly state: CheckRunState;
    readonly detailsUrl: string;
  }[];
  readonly updates: {
    readonly target: CheckRunTarget;
    readonly name: string;
    readonly state: CheckRunState;
    readonly detailsUrl: string;
  }[];
}

export function createRecordingGitHub(
  members: OrgMembers = ['octocat'],
  options: {
    readonly failUpdates?: boolean;
    /** How many of the first check run creations fail, as when GitHub has a hiccup. */
    readonly failCreates?: number;
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
  const creates: RecordingGitHub['creates'] = [];
  let createCalls = 0;
  return {
    membershipChecks,
    accountLookups,
    creates,
    updates,
    installationAccountId(installationId) {
      accountLookups.push(installationId);
      return Promise.resolve(
        options.accounts?.[installationId] ?? defaultAccountId(installationId),
      );
    },
    createCheckRun(target, name, state, detailsUrl) {
      createCalls += 1;
      if (createCalls <= (options.failCreates ?? 0)) {
        return Promise.reject(new Error('GitHub is down'));
      }
      creates.push({ target, name, state, detailsUrl });
      return Promise.resolve({ id: 900 + creates.length });
    },
    updateCheckRun(target, name, state, detailsUrl) {
      if (options.failUpdates === true) return Promise.reject(new Error('GitHub is down'));
      updates.push({ target, name, state, detailsUrl });
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
