import { TargusError } from '@targus/core';
import { z } from 'zod';

/** The GitHub user behind an OAuth access token. */
export interface GitHubUser {
  readonly githubId: number;
  readonly login: string;
  readonly avatarUrl: string;
}

/** GitHub's web OAuth flow for the targus GitHub App (plan.md section 5.2, login). */
export interface GitHubOAuth {
  /** Where to send the browser to sign in. */
  authorizeUrl(params: { readonly state: string; readonly redirectUri: string }): string;
  /** Exchange the callback's `code` for a user access token; `unauthorized` when GitHub refuses. */
  exchangeCode(params: { readonly code: string; readonly redirectUri: string }): Promise<string>;
  fetchUser(accessToken: string): Promise<GitHubUser>;
}

export interface GitHubAppOAuthOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  /** `https://github.com`, or a stub. */
  readonly oauthOrigin: string;
  /** `https://api.github.com`, or a stub. */
  readonly apiOrigin: string;
}

const TokenResponse = z.object({ access_token: z.string().min(1) });
const UserResponse = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  avatar_url: z.url(),
});

/** `GitHubOAuth` over `fetch`, which is injectable so tests never touch the network. */
export class GitHubAppOAuth implements GitHubOAuth {
  constructor(
    private readonly options: GitHubAppOAuthOptions,
    // A wrapper, not `fetch` itself: workerd rejects `fetch` called with another `this`.
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  authorizeUrl({ state, redirectUri }: { state: string; redirectUri: string }): string {
    const url = new URL(`${this.options.oauthOrigin}/login/oauth/authorize`);
    url.searchParams.set('client_id', this.options.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode({ code, redirectUri }: { code: string; redirectUri: string }) {
    const response = await this.fetchImpl(`${this.options.oauthOrigin}/login/oauth/access_token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    // GitHub answers 200 with `{ error, error_description }` for a bad or expired code.
    const parsed = TokenResponse.safeParse(await response.json().catch(() => null));
    if (!response.ok || !parsed.success) {
      throw new TargusError('unauthorized', 'GitHub did not accept the login code');
    }
    return parsed.data.access_token;
  }

  async fetchUser(accessToken: string): Promise<GitHubUser> {
    const response = await this.fetchImpl(`${this.options.apiOrigin}/user`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'targus',
      },
    });
    if (!response.ok) {
      throw new TargusError('unauthorized', `GitHub user lookup failed (${response.status})`);
    }
    const user = UserResponse.parse(await response.json());
    return { githubId: user.id, login: user.login, avatarUrl: user.avatar_url };
  }
}
