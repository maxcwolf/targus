import { createAppAuth } from '@octokit/auth-app';
import { request as octokitRequest } from '@octokit/request';
import type { CheckRunState, CheckRunTarget, GitHubClient } from '@targus/core';

/** The check run name targus reports on every commit (plan.md section 5.2). */
export const checkRunName = 'targus/ios';

export interface GitHubAppCredentials {
  readonly appId: string;
  /** PKCS#8 PEM; WebCrypto cannot import the PKCS#1 key GitHub hands out (see README). */
  readonly privateKey: string;
  /** REST API origin; defaults to `https://api.github.com` (a stub in the e2e suite). */
  readonly baseUrl?: string;
}

type Fetch = typeof fetch;
type Request = typeof octokitRequest;

function splitRepo(repo: string): { owner: string; repo: string } {
  const [owner = '', name = ''] = repo.split('/');
  return { owner, repo: name };
}

/** The check-run fields that change with the build state. */
function stateFields(state: CheckRunState) {
  const title =
    state.status === 'in_progress'
      ? 'Visual changes awaiting review'
      : state.conclusion === 'success'
        ? 'No unreviewed visual changes'
        : 'Visual review failed';
  const output = { title, summary: state.summary };
  return state.status === 'in_progress'
    ? { status: state.status, output }
    : { status: state.status, conclusion: state.conclusion, output };
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 404;
}

/**
 * `GitHubClient` for the targus GitHub App. Every call mints an installation access token from
 * the App's private key (plan.md section 5.2), against the same `baseUrl`. `fetch` is
 * injectable so tests never touch the network.
 */
export class OctokitGitHubClient implements GitHubClient {
  private readonly request: Request;
  private readonly auth;

  constructor(credentials: GitHubAppCredentials, fetchImpl: Fetch = fetch) {
    this.request = octokitRequest.defaults({
      baseUrl: credentials.baseUrl ?? 'https://api.github.com',
      headers: { 'user-agent': 'targus' },
      request: { fetch: fetchImpl },
    });
    this.auth = createAppAuth({
      appId: credentials.appId,
      privateKey: credentials.privateKey,
      request: this.request,
    });
  }

  private async headers(installationId: number): Promise<{ authorization: string }> {
    const { token } = await this.auth({ type: 'installation', installationId, refresh: true });
    return { authorization: `token ${token}` };
  }

  async createCheckRun(
    target: CheckRunTarget,
    state: CheckRunState,
    detailsUrl: string,
  ): Promise<{ id: number }> {
    const response = await this.request('POST /repos/{owner}/{repo}/check-runs', {
      ...splitRepo(target.repo),
      headers: await this.headers(target.installationId),
      name: checkRunName,
      head_sha: target.headSha,
      details_url: detailsUrl,
      ...stateFields(state),
    });
    return { id: Number(response.data.id) };
  }

  async updateCheckRun(
    target: CheckRunTarget,
    checkRunId: number,
    state: CheckRunState,
  ): Promise<void> {
    await this.request('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}', {
      ...splitRepo(target.repo),
      check_run_id: checkRunId,
      headers: await this.headers(target.installationId),
      ...stateFields(state),
    });
  }

  async isOrgMember(installationId: number, org: string, login: string): Promise<boolean> {
    try {
      await this.request('GET /orgs/{org}/members/{username}', {
        org,
        username: login,
        headers: await this.headers(installationId),
      });
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }
}

/**
 * `GitHubClient` used when the GitHub App is not configured. `createCheckRun` answers id 0,
 * which the results use-case treats as "no check run".
 */
export class NoopGitHubClient implements GitHubClient {
  createCheckRun(): Promise<{ id: number }> {
    return Promise.resolve({ id: 0 });
  }

  updateCheckRun(): Promise<void> {
    return Promise.resolve();
  }

  isOrgMember(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
