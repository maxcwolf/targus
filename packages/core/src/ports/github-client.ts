/** The commit and repository a check belongs to. */
export interface CheckRunTarget {
  readonly installationId: number;
  readonly repo: string;
  readonly headSha: string;
}

/**
 * The state of a build's check (plan.md section 5.2). The check is a commit status (ADR 0040):
 * `in_progress` is reported as `pending`, and `summary` is its description.
 */
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
  /**
   * Report the commit status named `name` (`checkRunName`) on the commit for the first time, and
   * return the id GitHub gave it. `detailsUrl` is where GitHub sends whoever clicks the check
   * on a pull request (ADR 0040).
   */
  createCheckRun(
    target: CheckRunTarget,
    name: string,
    state: CheckRunState,
    detailsUrl: string,
  ): Promise<{ id: number }>;
  /**
   * Move the commit status named `name` to a new state. A status is replaced, not edited, so
   * the name and the link are sent again.
   */
  updateCheckRun(
    target: CheckRunTarget,
    name: string,
    state: CheckRunState,
    detailsUrl: string,
  ): Promise<void>;
  /** Whether `login` is a member of `org`; used to authorize review sessions. */
  isOrgMember(installationId: number, org: string, login: string): Promise<boolean>;
  /**
   * GitHub's numeric id of the account, org or user, that the App installation belongs to.
   * Unlike a login it never changes hands, so it is what recognises the owner of a personal
   * account (ADR 0024). Rejects when GitHub cannot say (installation gone, GitHub failing).
   */
  installationAccountId(installationId: number): Promise<number>;
}
