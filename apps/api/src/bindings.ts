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
}
