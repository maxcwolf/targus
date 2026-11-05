/** The commit and repository a check run belongs to. */
export interface CheckRunTarget {
  readonly installationId: number;
  readonly repo: string;
  readonly headSha: string;
}

/** The mutable part of a check run (plan.md section 5.2). */
export type CheckRunState =
  | { readonly status: 'in_progress'; readonly summary: string }
  | {
      readonly status: 'completed';
      readonly conclusion: 'success' | 'failure';
      readonly summary: string;
    };

/**
 * The GitHub App operations targus needs. The adapter, `OctokitGitHubClient`, mints an
 * installation token per request from the App's private key.
 */
export interface GitHubClient {
  /** Create the `targus/ios` check run and return its id. */
  createCheckRun(
    target: CheckRunTarget,
    state: CheckRunState,
    detailsUrl: string,
  ): Promise<{ id: number }>;
  /** Move an existing check run to a new state. */
  updateCheckRun(target: CheckRunTarget, checkRunId: number, state: CheckRunState): Promise<void>;
  /** Whether `login` is a member of `org`; used to authorize review sessions. */
  isOrgMember(installationId: number, org: string, login: string): Promise<boolean>;
}
