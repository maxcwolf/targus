import type { GitHubClient } from '@targus/core';

import { createRecordingGitHub, type RecordingGitHub } from './github-recorder.ts';
import type { OrgMembers } from './org-members.ts';

/** What Octokit throws for a suspended installation: an error with the HTTP status on it. */
export class GitHubStatusError extends Error {
  constructor(readonly status: number) {
    super(`GitHub answered ${String(status)}`);
  }
}

/**
 * A recording GitHub client whose membership checks fail for the orgs in `unreachable`, as they
 * do when an org's App installation has been suspended (403) or GitHub is failing.
 */
export function createUnreachableGitHub(
  members: OrgMembers,
  unreachable: readonly string[],
  status = 403,
): RecordingGitHub {
  const github = createRecordingGitHub(members);
  const isOrgMember: GitHubClient['isOrgMember'] = (installationId, org, login) => {
    if (unreachable.includes(org)) {
      github.membershipChecks.push({ org, login });
      return Promise.reject(new GitHubStatusError(status));
    }
    return github.isOrgMember(installationId, org, login);
  };
  return { ...github, isOrgMember };
}
