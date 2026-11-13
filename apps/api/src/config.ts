import { defaultThreshold, type FeatureFlags, resolveFeatureFlags } from '@targus/core';
import { z } from 'zod';

// Configuration arrives as plain string variables (Worker bindings on Cloudflare) and is
// validated here, the only place that reads raw variables. Nothing here knows the platform.
const optionalSecret = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? null : value));

/** A URL origin var with a default, without a trailing slash. */
const origin = (fallback: string) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .url()
      .default(fallback)
      .transform((url) => url.replace(/\/+$/, '')),
  );

/** `true` or `false`; blank or absent is `false`. */
const flag = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
);

const s3Names = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const;

const VarsSchema = z
  .object({
    APP_VERSION: z.string().min(1),
    PUBLIC_URL: z.url().transform((url) => url.replace(/\/+$/, '')),
    DIFF_THRESHOLD: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.coerce.number().min(0).max(1).default(defaultThreshold),
    ),
    ADMIN_TOKEN: optionalSecret,
    GITHUB_APP_ID: optionalSecret,
    // Secrets pasted on one line often carry literal "\n"; PEM needs real newlines.
    GITHUB_APP_PRIVATE_KEY: optionalSecret.transform((key) => key?.replaceAll('\\n', '\n') ?? null),
    SESSION_SECRET: optionalSecret,
    GITHUB_CLIENT_ID: optionalSecret,
    GITHUB_CLIENT_SECRET: optionalSecret,
    GITHUB_APP_SLUG: optionalSecret.pipe(
      z
        .string()
        .regex(/^[A-Za-z0-9-]+$/)
        .nullable(),
    ),
    GITHUB_OAUTH_ORIGIN: origin('https://github.com'),
    GITHUB_API_ORIGIN: origin('https://api.github.com'),
    FEATURES: z
      .string()
      .optional()
      .transform((text, context) => {
        const resolved = resolveFeatureFlags(text);
        if (resolved.ok) return resolved.flags;
        context.addIssue({ code: 'custom', message: `FEATURES: ${resolved.problem}` });
        return z.NEVER;
      }),
    S3_ENDPOINT: optionalSecret.pipe(z.url().nullable()),
    S3_REGION: optionalSecret,
    S3_BUCKET: optionalSecret,
    S3_ACCESS_KEY_ID: optionalSecret,
    S3_SECRET_ACCESS_KEY: optionalSecret,
    S3_FORCE_PATH_STYLE: flag,
  })
  .refine((vars) => (vars.GITHUB_APP_ID === null) === (vars.GITHUB_APP_PRIVATE_KEY === null), {
    message: 'set both GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY, or neither',
  })
  .refine((vars) => (vars.GITHUB_CLIENT_ID === null) === (vars.GITHUB_CLIENT_SECRET === null), {
    message: 'set both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, or neither',
  })
  .refine((vars) => new Set(s3Names.map((name) => vars[name] === null)).size === 1, {
    message: `set all of ${s3Names.join(', ')}, or none`,
  })
  .refine((vars) => !vars.GITHUB_APP_PRIVATE_KEY?.includes('BEGIN RSA PRIVATE KEY'), {
    message: 'GITHUB_APP_PRIVATE_KEY must be PKCS#8 (BEGIN PRIVATE KEY); see apps/api/README.md',
  });

/** An S3-compatible bucket (AWS S3, MinIO, R2's S3 API) that holds the images. */
export interface S3Config {
  /** Service origin, e.g. `https://s3.us-east-1.amazonaws.com` or `http://localhost:9000`. */
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** `endpoint/bucket/key` (MinIO) instead of `bucket.endpoint/key` (AWS virtual-hosted). */
  readonly forcePathStyle: boolean;
}

export interface ApiConfig {
  readonly version: string;
  /** Origin of the review UI, without a trailing slash. */
  readonly publicUrl: string;
  /**
   * The changed-pixel ratio at or under which a snapshot is unchanged. `POST /api/builds` sends
   * it to the CLI, which diffs with it, and results measured with another one are rejected
   * (ADR 0028).
   */
  readonly diffThreshold: number;
  /** Null disables the admin routes. */
  readonly adminToken: string | null;
  /** Null when the GitHub App is not configured; check runs are then skipped. */
  readonly githubApp: { readonly appId: string; readonly privateKey: string } | null;
  /** Signs the session and OAuth state cookies. Null disables every session route. */
  readonly sessionSecret: string | null;
  /** The GitHub App's OAuth client. Null disables GitHub login. */
  readonly githubOAuth: { readonly clientId: string; readonly clientSecret: string } | null;
  /**
   * GitHub's page for installing the App on an account, which self-serve project creation links
   * to. Null when `GITHUB_APP_SLUG` is unset.
   */
  readonly githubAppInstallUrl: string | null;
  /** Origin of GitHub's OAuth pages (`https://github.com`; a stub in the e2e suite). */
  readonly githubOAuthOrigin: string;
  /** Origin of the GitHub REST API (`https://api.github.com`; a stub in the e2e suite). */
  readonly githubApiOrigin: string;
  /** Where images live: an S3-compatible bucket, or null for the host's own store (R2). */
  readonly s3: S3Config | null;
  /** Which features are on: each one's default, changed by `FEATURES` (ADR 0048). */
  readonly features: FeatureFlags;
}

/**
 * The raw variables, as a host supplies them: vars in wrangler.jsonc plus secrets (`wrangler
 * secret put` / `.dev.vars`) on Cloudflare. Secrets are optional here; `loadConfig` validates.
 */
export interface ConfigVars {
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
  /** The App's name in its GitHub URL (`github.com/apps/<slug>`), for the install link. */
  readonly GITHUB_APP_SLUG?: string;
  /** Origin of GitHub's OAuth pages; defaults to https://github.com. */
  readonly GITHUB_OAUTH_ORIGIN?: string;
  /** Origin of the GitHub REST API; defaults to https://api.github.com. */
  readonly GITHUB_API_ORIGIN?: string;
  /** Features to turn on or off, e.g. `library=off`; each keeps its default otherwise. */
  readonly FEATURES?: string;
  /** Origin of an S3-compatible service. Images go to S3 only when all five S3 vars are set. */
  readonly S3_ENDPOINT?: string;
  /** The bucket's region (`auto` for R2, any value for MinIO). */
  readonly S3_REGION?: string;
  /** The bucket that holds the images. */
  readonly S3_BUCKET?: string;
  /** Secret: S3 access key id. */
  readonly S3_ACCESS_KEY_ID?: string;
  /** Secret: S3 secret access key. */
  readonly S3_SECRET_ACCESS_KEY?: string;
  /** `true` for path-style URLs (MinIO); defaults to virtual-hosted style. */
  readonly S3_FORCE_PATH_STYLE?: string;
}

type Vars = z.infer<typeof VarsSchema>;

/** The S3 bucket from the vars, or null when the S3 vars are unset (the schema checks all-or-none). */
function s3From(vars: Vars): S3Config | null {
  const { S3_ENDPOINT: endpoint, S3_REGION: region, S3_BUCKET: bucket } = vars;
  const { S3_ACCESS_KEY_ID: accessKeyId, S3_SECRET_ACCESS_KEY: secretAccessKey } = vars;
  if (endpoint === null || region === null || bucket === null) return null;
  if (accessKeyId === null || secretAccessKey === null) return null;
  const forcePathStyle = vars.S3_FORCE_PATH_STYLE;
  return { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle };
}

export function loadConfig(raw: ConfigVars): ApiConfig {
  const vars = VarsSchema.parse(raw);
  const appId = vars.GITHUB_APP_ID;
  const privateKey = vars.GITHUB_APP_PRIVATE_KEY;
  const clientId = vars.GITHUB_CLIENT_ID;
  const clientSecret = vars.GITHUB_CLIENT_SECRET;
  return {
    version: vars.APP_VERSION,
    publicUrl: vars.PUBLIC_URL,
    diffThreshold: vars.DIFF_THRESHOLD,
    adminToken: vars.ADMIN_TOKEN,
    githubApp: appId === null || privateKey === null ? null : { appId, privateKey },
    sessionSecret: vars.SESSION_SECRET,
    githubOAuth: clientId === null || clientSecret === null ? null : { clientId, clientSecret },
    githubAppInstallUrl:
      vars.GITHUB_APP_SLUG === null
        ? null
        : `${vars.GITHUB_OAUTH_ORIGIN}/apps/${vars.GITHUB_APP_SLUG}/installations/new`,
    githubOAuthOrigin: vars.GITHUB_OAUTH_ORIGIN,
    githubApiOrigin: vars.GITHUB_API_ORIGIN,
    s3: s3From(vars),
    features: vars.FEATURES,
  };
}
