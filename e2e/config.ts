import { parseArgs } from 'node:util';

import { z } from 'zod';

// The only file in e2e/ that reads process.env (ESLint no-restricted-properties).
const EnvSchema = z.object({
  CI: z.string().optional(),
  E2E_PORT: z.coerce.number().int().positive().default(8787),
  E2E_GITHUB_STUB_PORT: z.coerce.number().int().positive().default(8788),
  // Passed through to the `targus` CLI child process, which runs git.
  PATH: z.string().default(''),
  HOME: z.string().optional(),
});

const env = EnvSchema.parse(process.env);

export const e2eConfig = {
  isCI: env.CI !== undefined && env.CI !== '' && env.CI !== 'false',
  port: env.E2E_PORT,
  /** Where the GitHub stub (support/github-stub.ts) listens; the Worker's GitHub origins. */
  githubStubPort: env.E2E_GITHUB_STUB_PORT,
  /** `ADMIN_TOKEN` of the local Worker, set with `wrangler dev --var` by playwright.config.ts. */
  adminToken: 'e2e-admin-token',
  /** Likewise `SESSION_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `GITHUB_APP_ID`. */
  sessionSecret: 'e2e-session-secret',
  githubClientId: 'e2e-client-id',
  githubClientSecret: 'e2e-client-secret',
  githubAppId: '424242',
  /** The GitHub App installation every e2e project is created with. */
  installationId: 42,
  path: env.PATH,
  home: env.HOME,
} as const;

const LocalFlagsSchema = z.object({
  port: z.coerce.number().int().positive().default(8900),
  'github-stub-port': z.coerce.number().int().positive().default(8901),
  'public-url': z
    .url()
    .optional()
    .transform((url) => url?.replace(/\/+$/, '')),
});

export interface LocalConfig {
  readonly port: number;
  readonly githubStubPort: number;
  /**
   * `PUBLIC_URL` of the local Worker, by default the Worker itself. Set it to the origin of a
   * Vite dev server that proxies `/api` to the Worker, or approving answers 403 (ADR 0015).
   */
  readonly publicUrl: string;
}

/**
 * Settings of `yarn dev:local` (local.ts) from its flags: `--port`, `--github-stub-port`,
 * `--public-url`. The default ports differ from the e2e ones (8787, 8788) so both can run at once.
 */
export function localConfigFrom(args: readonly string[]): LocalConfig {
  const { values } = parseArgs({
    args: [...args],
    options: {
      port: { type: 'string' },
      'github-stub-port': { type: 'string' },
      'public-url': { type: 'string' },
    },
  });
  const flags = LocalFlagsSchema.parse(values);
  return {
    port: flags.port,
    githubStubPort: flags['github-stub-port'],
    publicUrl: flags['public-url'] ?? `http://127.0.0.1:${flags.port}`,
  };
}
