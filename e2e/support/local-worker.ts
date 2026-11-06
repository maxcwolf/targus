import { generateKeyPairSync } from 'node:crypto';

import { e2eConfig } from '../config.ts';

// How a local Worker is started against the GitHub stub: by playwright.config.ts for the e2e
// suite and by local.ts for `yarn dev:local`. Both use a local D1 and R2 only (`--persist-to`,
// `--local` migrations); nothing here can reach a remote database.

export interface LocalWorker {
  /** Port `wrangler dev` listens on, on 127.0.0.1. */
  readonly port: number;
  /** Port the GitHub stub (support/github-stub.ts) listens on, on 127.0.0.1. */
  readonly githubStubPort: number;
  /** `PUBLIC_URL`: the origin the browser is on. Session writes from any other origin get 403. */
  readonly publicUrl: string;
  /** Local D1 and R2 state, wiped before every start. Gitignored by the root `.wrangler/`. */
  readonly persistTo: string;
  /**
   * Where to build the review UI and serve it from, or null for `apps/web/dist` (wrangler.jsonc).
   * A folder of its own keeps runs in one worktree from emptying each other's UI mid-build.
   */
  readonly webOutDir: string | null;
}

/**
 * A throwaway GitHub App key: the Worker signs installation-token requests with it and the stub
 * never checks the signature. Newlines travel as literal "\\n" through `--var`, which
 * apps/api/src/config.ts turns back into real ones.
 */
function throwawayPrivateKey(): string {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey.replaceAll('\n', '\\n');
}

/** The Worker's secrets and GitHub origins: known test values and the stub, never real GitHub. */
function workerVars(worker: LocalWorker): Record<string, string> {
  const githubStub = `http://127.0.0.1:${worker.githubStubPort}`;
  return {
    ADMIN_TOKEN: e2eConfig.adminToken,
    SESSION_SECRET: e2eConfig.sessionSecret,
    GITHUB_CLIENT_ID: e2eConfig.githubClientId,
    GITHUB_CLIENT_SECRET: e2eConfig.githubClientSecret,
    GITHUB_APP_ID: e2eConfig.githubAppId,
    GITHUB_APP_PRIVATE_KEY: throwawayPrivateKey(),
    GITHUB_OAUTH_ORIGIN: githubStub,
    GITHUB_API_ORIGIN: githubStub,
    PUBLIC_URL: worker.publicUrl,
  };
}

/**
 * Shell commands, run from the repo root one after another, that wipe the local state, apply
 * the migrations to a fresh local D1 and build the review UI the Worker serves.
 */
export function workerSetupCommands(worker: LocalWorker): string[] {
  const persistTo = JSON.stringify(worker.persistTo);
  const outDir =
    worker.webOutDir === null ? '' : ` --outDir ${JSON.stringify(worker.webOutDir)} --emptyOutDir`;
  return [
    `rm -rf ${persistTo}`,
    `yarn workspace @targus/api db:migrate:local --persist-to ${persistTo}`,
    `yarn workspace @targus/web build${outDir}`,
  ];
}

/**
 * The shell command that serves the API and the built UI from one local Worker, as in
 * production. `@targus/api dev` bundles @targus/core from source via the "development"
 * condition (ADR 0010).
 */
export function workerDevCommand(worker: LocalWorker): string {
  const varFlags = Object.entries(workerVars(worker))
    .map(([name, value]) => `--var "${name}:${value}"`)
    .join(' ');
  const persistTo = JSON.stringify(worker.persistTo);
  // `--assets` replaces only the directory; the SPA fallback and run_worker_first stay.
  const assets = worker.webOutDir === null ? '' : ` --assets ${JSON.stringify(worker.webOutDir)}`;
  return `yarn workspace @targus/api dev --ip 127.0.0.1 --port ${worker.port} --persist-to ${persistTo}${assets} ${varFlags}`;
}

/** Environment for the Worker commands: no wrangler telemetry. */
export const workerEnv = { WRANGLER_SEND_METRICS: 'false' } as const;
