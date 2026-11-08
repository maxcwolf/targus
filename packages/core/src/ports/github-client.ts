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
  /** Create the check run named `name` (`checkRunName`) and return its id. */
  createCheckRun(
    target: CheckRunTarget,
    name: string,
    state: CheckRunState,
    detailsUrl: string,
  ): Promise<{ id: number }>;
  /** Move an existing check run to a new state. */
  updateCheckRun(target: CheckRunTarget, checkRunId: number, state: CheckRunState): Promise<void>;
  /** Whether `login` is a member of `org`; used to authorize review sessions. */
  isOrgMember(installationId: number, org: string, login: string): Promise<boolean>;
  /**
   * GitHub's numeric id of the account, org or user, that the App installation belongs to.
   * Unlike a login it never changes hands, so it is what recognises the owner of a personal
   * account (ADR 0024). Rejects when GitHub cannot say (installation gone, GitHub failing).
   */
  installationAccountId(installationId: number): Promise<number>;
}
