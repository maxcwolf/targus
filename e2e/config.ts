import { z } from 'zod';

// The only file in e2e/ that reads process.env (ESLint no-restricted-properties).
const EnvSchema = z.object({
  CI: z.string().optional(),
  E2E_PORT: z.coerce.number().int().positive().default(8787),
  // Passed through to the `targus` CLI child process, which runs git.
  PATH: z.string().default(''),
  HOME: z.string().optional(),
});

const env = EnvSchema.parse(process.env);

export const e2eConfig = {
  isCI: env.CI !== undefined && env.CI !== '' && env.CI !== 'false',
  port: env.E2E_PORT,
  /** `ADMIN_TOKEN` of the local Worker, set with `wrangler dev --var` by playwright.config.ts. */
  adminToken: 'e2e-admin-token',
  path: env.PATH,
  home: env.HOME,
} as const;
