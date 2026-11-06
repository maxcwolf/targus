import { TargusError } from '@targus/core';
import { z } from 'zod';

import { parseApiUrl } from './api-url.ts';
import type { CiEnv } from './run/ci-context.ts';

/** The local `wrangler dev` Worker, used when neither `--api-url` nor `TARGUS_API_URL` is set. */
const defaultApiUrl = 'http://localhost:8787';

// The only file in this package allowed to read process.env (ESLint no-restricted-properties).
const EnvSchema = z.object({
  // Checked by parseApiUrl, and only when no --api-url overrides it.
  TARGUS_API_URL: z.string().optional(),
  TARGUS_TOKEN: z.string().optional(),
  // CI variables `targus run` derives the branch and PR number from (run/ci-context.ts).
  CIRCLE_BRANCH: z.string().optional(),
  CIRCLE_PULL_REQUEST: z.string().optional(),
  CIRCLE_PR_NUMBER: z.string().optional(),
  GITHUB_HEAD_REF: z.string().optional(),
  GITHUB_REF_NAME: z.string().optional(),
  GITHUB_REF: z.string().optional(),
});

/** Flags that take the place of an environment variable. */
export interface ConfigOverrides {
  /** `--api-url`; wins over `TARGUS_API_URL`, which is then not read at all. */
  readonly apiUrl?: string | undefined;
}

export interface CliConfig {
  /** The validated, normalised API base URL: `--api-url`, else `TARGUS_API_URL`, else local. */
  readonly apiUrl: string;
  /** The project token. Only ever read from `TARGUS_TOKEN`, never a flag, so it stays out of logs. */
  readonly token: string | undefined;
  readonly ci: CiEnv;
}

/**
 * Validate the environment and the flags that override it. Called only when a command that needs
 * it runs, so `targus --help` works anywhere, and before any device work, so a bad API URL or an
 * empty token fails in a second rather than after the capture. Throws a TargusError naming the
 * flag or variable at fault.
 */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  overrides: ConfigOverrides = {},
): CliConfig {
  // Every variable is an optional string, so this picks fields and cannot fail on a real env.
  const { TARGUS_API_URL, TARGUS_TOKEN, ...ci } = EnvSchema.parse(env);
  if (TARGUS_TOKEN?.trim() === '') {
    throw new TargusError('unauthorized', 'TARGUS_TOKEN is empty: export the project token');
  }
  const apiUrl =
    overrides.apiUrl === undefined
      ? parseApiUrl(TARGUS_API_URL ?? defaultApiUrl, 'TARGUS_API_URL')
      : parseApiUrl(overrides.apiUrl, '--api-url');
  return { apiUrl, token: TARGUS_TOKEN, ci };
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
