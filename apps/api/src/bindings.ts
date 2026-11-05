/**
 * Worker bindings declared in wrangler.jsonc (vars) or set with `wrangler secret put` /
 * `.dev.vars` (secrets, optional here). Keep the two in step; `config.ts` validates them.
 */
export interface Bindings {
  readonly DB: D1Database;
  readonly IMAGES: R2Bucket;
  readonly APP_VERSION: string;
  /** Origin of the deployed review UI, used for check-run and review links. */
  readonly PUBLIC_URL: string;
  /** Default changed-pixel ratio at or under which a snapshot is unchanged. */
  readonly DIFF_THRESHOLD: string;
  /** Secret: bearer token for /api/admin/*. Admin routes reject every request without it. */
  readonly ADMIN_TOKEN?: string;
  /** Secret: GitHub App id. Check runs are skipped unless both GitHub secrets are set. */
  readonly GITHUB_APP_ID?: string;
  /** Secret: GitHub App private key, PKCS#8 PEM. */
  readonly GITHUB_APP_PRIVATE_KEY?: string;
  /** Secret: signs the session cookie. Every session route answers 401 without it. */
  readonly SESSION_SECRET?: string;
  /** Secret: the GitHub App's OAuth client id. GitHub login needs both OAuth secrets. */
  readonly GITHUB_CLIENT_ID?: string;
  /** Secret: the GitHub App's OAuth client secret. */
  readonly GITHUB_CLIENT_SECRET?: string;
  /** Origin of GitHub's OAuth pages; defaults to https://github.com. */
  readonly GITHUB_OAUTH_ORIGIN?: string;
  /** Origin of the GitHub REST API; defaults to https://api.github.com. */
  readonly GITHUB_API_ORIGIN?: string;
}
