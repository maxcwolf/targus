import { createAppAuth } from '@octokit/auth-app';
import { request as octokitRequest } from '@octokit/request';
import type {
  AccessibleRepo,
  CheckRunState,
  CheckRunTarget,
  GitHubClient,
  InstallationAccount,
} from '@targus/core';

import { InstallationTokenCache, type InstallationToken } from './installation-token-cache.ts';
import { systemClock } from './system-clock.adapter.ts';

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

/** GitHub rejects a status description longer than this. */
const descriptionLimit = 140;

/** The commit-status fields that change with the build state. */
function stateFields(state: CheckRunState) {
  return {
    state: state.status === 'in_progress' ? ('pending' as const) : state.conclusion,
    description: state.summary.slice(0, descriptionLimit),
  };
}

function hasStatus(error: unknown, status: number): boolean {
  return (
    typeof error === 'object' && error !== null && 'status' in error && error.status === status
  );
}

/** GitHub's largest page, and how many pages of an installation's repositories are read. */
const repoPageSize = 100;
const maxRepoPages = 10;

/** The id and login of an installation's account; GitHub types it loosely, so it is checked. */
function accountOf(account: unknown, installationId: number): InstallationAccount {
  if (typeof account === 'object' && account !== null && 'id' in account && 'login' in account) {
    const { id, login } = account;
    if (typeof id === 'number' && typeof login === 'string') return { id, login };
  }
  throw new Error(`installation ${String(installationId)} names no account`);
}

/** Request headers carrying the installation token (Octokit's headers are an open record). */
interface AuthHeaders {
  [name: string]: string;
  authorization: string;
}

/** Installation tokens shared by every client of this isolate (see `InstallationTokenCache`). */
const isolateTokens = new InstallationTokenCache(systemClock);

/**
 * `GitHubClient` for the targus GitHub App. Calls carry an installation access token minted from
 * the App's private key (plan.md section 5.2), against the same `baseUrl`. Tokens come from
 * `tokens`, by default one cache per isolate, so a token is minted about once an hour per
 * installation rather than per call; a 401 drops the cached token so the next call mints a new
 * one. `fetch` is injectable so tests never touch the network.
 */
export class OctokitGitHubClient implements GitHubClient {
  private readonly request: Request;
  private readonly auth;
  private readonly cacheKey: string;

  constructor(
    credentials: GitHubAppCredentials,
    fetchImpl: Fetch = fetch,
    private readonly tokens: InstallationTokenCache = isolateTokens,
  ) {
    const baseUrl = credentials.baseUrl ?? 'https://api.github.com';
    this.request = octokitRequest.defaults({
      baseUrl,
      headers: { 'user-agent': 'targus' },
      request: { fetch: fetchImpl },
    });
    this.auth = createAppAuth({
      appId: credentials.appId,
      privateKey: credentials.privateKey,
      request: this.request,
    });
    this.cacheKey = `${baseUrl} app ${credentials.appId}`;
  }

  /** A fresh token, bypassing `@octokit/auth-app`'s own cache, which reads `Date` directly. */
  private async mint(installationId: number): Promise<InstallationToken> {
    const auth = await this.auth({ type: 'installation', installationId, refresh: true });
    return { token: auth.token, expiresAt: new Date(auth.expiresAt) };
  }

  /** Send a request with the installation's token, dropping the token if GitHub rejects it. */
  private async withToken<T>(
    installationId: number,
    send: (headers: AuthHeaders) => Promise<T>,
  ): Promise<T> {
    const key = `${this.cacheKey} installation ${String(installationId)}`;
    const token = await this.tokens.get(key, () => this.mint(installationId));
    try {
      return await send({ authorization: `token ${token}` });
    } catch (error) {
      if (hasStatus(error, 401)) this.tokens.evict(key);
      throw error;
    }
  }

  /**
   * The build's check is a commit status, not a check run: on a pull request GitHub links a
   * status straight to its `target_url`, the review UI, where a check run opens GitHub's own
   * page first (ADR 0040). The newest status of a context is the one GitHub shows.
   */
  async createCheckRun(
    target: CheckRunTarget,
    name: string,
    state: CheckRunState,
    detailsUrl: string,
  ): Promise<{ id: number }> {
    const response = await this.withToken(target.installationId, (headers) =>
      this.request('POST /repos/{owner}/{repo}/statuses/{sha}', {
        ...splitRepo(target.repo),
        sha: target.headSha,
        headers,
        context: name,
        target_url: detailsUrl,
        ...stateFields(state),
      }),
    );
    return { id: response.data.id };
  }

  async updateCheckRun(
    target: CheckRunTarget,
    name: string,
    state: CheckRunState,
    detailsUrl: string,
  ): Promise<void> {
    await this.createCheckRun(target, name, state, detailsUrl);
  }

  /**
   * Whether `login` is a public or private member of `org`. A 404 means no, and that includes a
   * 404 from minting the token, which is what GitHub answers for a deleted installation. Any
   * other failure (a suspended installation answers 403) is thrown.
   */
  async isOrgMember(installationId: number, org: string, login: string): Promise<boolean> {
    try {
      await this.withToken(installationId, (headers) =>
        this.request('GET /orgs/{org}/members/{username}', { org, username: login, headers }),
      );
      return true;
    } catch (error) {
      if (hasStatus(error, 404)) return false;
      throw error;
    }
  }

  /**
   * The account the installation is on, from `GET /app/installations/{id}`, which authenticates
   * as the App itself (a JWT), not as the installation. Any failure is thrown.
   */
  private async readAccount(installationId: number): Promise<InstallationAccount> {
    const { token } = await this.auth({ type: 'app' });
    const response = await this.request('GET /app/installations/{installation_id}', {
      installation_id: installationId,
      headers: { authorization: `bearer ${token}` },
    });
    return accountOf(response.data.account, installationId);
  }

  async installationAccountId(installationId: number): Promise<number> {
    return (await this.readAccount(installationId)).id;
  }

  /** As `installationAccountId`, except that a 404 (the App has no such installation) is null. */
  async installationAccount(installationId: number): Promise<InstallationAccount | null> {
    try {
      return await this.readAccount(installationId);
    } catch (error) {
      if (hasStatus(error, 404)) return null;
      throw error;
    }
  }

  /** Every page of `GET /installation/repositories`, up to `maxRepoPages` of them. */
  async listInstallationRepos(installationId: number): Promise<AccessibleRepo[]> {
    const repos: AccessibleRepo[] = [];
    for (let page = 1; page <= maxRepoPages; page += 1) {
      const response = await this.withToken(installationId, (headers) =>
        this.request('GET /installation/repositories', { per_page: repoPageSize, page, headers }),
      );
      const { repositories } = response.data;
      repos.push(
        ...repositories.map((repository) => ({
          repo: repository.full_name,
          defaultBranch: repository.default_branch,
        })),
      );
      if (repositories.length < repoPageSize) break;
    }
    return repos;
  }
}

/**
 * `GitHubClient` used when the GitHub App is not configured. `createCheckRun` answers id 0,
 * which the results use-case treats as "no check".
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

  /** There is no installation to ask, so no account is ever recognised. */
  installationAccountId(): Promise<number> {
    return Promise.reject(new Error('the GitHub App is not configured'));
  }

  installationAccount(): Promise<null> {
    return Promise.resolve(null);
  }

  listInstallationRepos(): Promise<AccessibleRepo[]> {
    return Promise.resolve([]);
  }
}
