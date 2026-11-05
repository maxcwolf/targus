import { z } from 'zod';

import type { Bindings } from './bindings.js';

// Workers have no process.env: configuration arrives as bindings and is validated here, the
// only place that reads raw variables.
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

const VarsSchema = z
  .object({
    APP_VERSION: z.string().min(1),
    PUBLIC_URL: z.url().transform((url) => url.replace(/\/+$/, '')),
    DIFF_THRESHOLD: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.coerce.number().min(0).max(1).default(0.001),
    ),
    ADMIN_TOKEN: optionalSecret,
    GITHUB_APP_ID: optionalSecret,
    // Secrets pasted on one line often carry literal "\n"; PEM needs real newlines.
    GITHUB_APP_PRIVATE_KEY: optionalSecret.transform((key) => key?.replaceAll('\\n', '\n') ?? null),
    SESSION_SECRET: optionalSecret,
    GITHUB_CLIENT_ID: optionalSecret,
    GITHUB_CLIENT_SECRET: optionalSecret,
    GITHUB_OAUTH_ORIGIN: origin('https://github.com'),
    GITHUB_API_ORIGIN: origin('https://api.github.com'),
  })
  .refine((vars) => (vars.GITHUB_APP_ID === null) === (vars.GITHUB_APP_PRIVATE_KEY === null), {
    message: 'set both GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY, or neither',
  })
  .refine((vars) => (vars.GITHUB_CLIENT_ID === null) === (vars.GITHUB_CLIENT_SECRET === null), {
    message: 'set both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, or neither',
  })
  .refine((vars) => !vars.GITHUB_APP_PRIVATE_KEY?.includes('BEGIN RSA PRIVATE KEY'), {
    message: 'GITHUB_APP_PRIVATE_KEY must be PKCS#8 (BEGIN PRIVATE KEY); see apps/api/README.md',
  });

export interface ApiConfig {
  readonly version: string;
  /** Origin of the review UI, without a trailing slash. */
  readonly publicUrl: string;
  readonly diffThreshold: number;
  /** Null disables the admin routes. */
  readonly adminToken: string | null;
  /** Null when the GitHub App is not configured; check runs are then skipped. */
  readonly githubApp: { readonly appId: string; readonly privateKey: string } | null;
  /** Signs the session and OAuth state cookies. Null disables every session route. */
  readonly sessionSecret: string | null;
  /** The GitHub App's OAuth client. Null disables GitHub login. */
  readonly githubOAuth: { readonly clientId: string; readonly clientSecret: string } | null;
  /** Origin of GitHub's OAuth pages (`https://github.com`; a stub in the e2e suite). */
  readonly githubOAuthOrigin: string;
  /** Origin of the GitHub REST API (`https://api.github.com`; a stub in the e2e suite). */
  readonly githubApiOrigin: string;
}

type ConfigBindings = Omit<Bindings, 'DB' | 'IMAGES'>;

export function loadConfig(bindings: ConfigBindings): ApiConfig {
  const vars = VarsSchema.parse(bindings);
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
    githubOAuthOrigin: vars.GITHUB_OAUTH_ORIGIN,
    githubApiOrigin: vars.GITHUB_API_ORIGIN,
  };
}
