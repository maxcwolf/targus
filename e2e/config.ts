import { z } from 'zod';

// The only file in e2e/ that reads process.env (ESLint no-restricted-properties).
const EnvSchema = z.object({
  CI: z.string().optional(),
  E2E_PORT: z.coerce.number().int().positive().default(8787),
});

const env = EnvSchema.parse(process.env);

export const e2eConfig = {
  isCI: env.CI !== undefined && env.CI !== '' && env.CI !== 'false',
  port: env.E2E_PORT,
} as const;
