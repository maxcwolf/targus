import { z } from 'zod';

// The only file in this package allowed to read process.env (ESLint no-restricted-properties).
const EnvSchema = z.object({
  // Defaults to the local `wrangler dev` Worker until a hosted URL exists (M2).
  TARGUS_API_URL: z.url().default('http://localhost:8787'),
  TARGUS_TOKEN: z.string().min(1).optional(),
});

export interface CliConfig {
  readonly apiUrl: string;
  readonly token: string | undefined;
}

/** Validate the environment once at startup; throws a readable error when it is invalid. */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CliConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid targus environment:\n${z.prettifyError(result.error)}`);
  }
  return { apiUrl: result.data.TARGUS_API_URL, token: result.data.TARGUS_TOKEN };
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
