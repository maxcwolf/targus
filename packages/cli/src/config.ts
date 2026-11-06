import { TargusError } from '@targus/core';
import { z } from 'zod';

import type { CiEnv } from './run/ci-context.ts';

// The only file in this package allowed to read process.env (ESLint no-restricted-properties).
const EnvSchema = z.object({
  // Defaults to the local `wrangler dev` Worker.
  TARGUS_API_URL: z.url().default('http://localhost:8787'),
  TARGUS_TOKEN: z.string().min(1).optional(),
  // CI variables `targus run` derives the branch and PR number from (run/ci-context.ts).
  CIRCLE_BRANCH: z.string().optional(),
  CIRCLE_PULL_REQUEST: z.string().optional(),
  CIRCLE_PR_NUMBER: z.string().optional(),
  GITHUB_HEAD_REF: z.string().optional(),
  GITHUB_REF_NAME: z.string().optional(),
  GITHUB_REF: z.string().optional(),
});

export interface CliConfig {
  readonly apiUrl: string;
  /** The project token. Only ever read from `TARGUS_TOKEN`, never a flag, so it stays out of logs. */
  readonly token: string | undefined;
  readonly ci: CiEnv;
}

/**
 * Validate the environment. Called only when a command that needs it runs, so `targus --help`
 * works anywhere; throws a `bad_request` TargusError naming the invalid variables.
 */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CliConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new TargusError(
      'bad_request',
      `invalid targus environment:\n${z.prettifyError(result.error)}`,
    );
  }
  const { TARGUS_API_URL, TARGUS_TOKEN, ...ci } = result.data;
  return { apiUrl: TARGUS_API_URL, token: TARGUS_TOKEN, ci };
}

/** `TARGUS_DEBUG=1` (or `true`) adds stack traces to error messages. Read apart from `loadConfig`. */
export function debugEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const value = env.TARGUS_DEBUG?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

/**
 * The environment child processes inherit. Adapters add variables to it (for example
 * `SIMCTL_CHILD_*`) rather than replace it, so `xcrun` still finds the developer directory.
 */
export function inheritedEnv(): Readonly<Record<string, string | undefined>> {
  return process.env;
}

/** The simulator and app the opt-in real-device test runs against, when both are set. */
export interface SimulatorTestTarget {
  readonly udid: string;
  readonly app: string;
}

export function simulatorTestTarget(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SimulatorTestTarget | null {
  const udid = env.TARGUS_SIMULATOR_UDID;
  const app = env.TARGUS_APP;
  return udid && app ? { udid, app } : null;
}
