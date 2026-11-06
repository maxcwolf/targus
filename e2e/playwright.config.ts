import { generateKeyPairSync } from 'node:crypto';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

import { e2eConfig } from './config.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const baseURL = `http://127.0.0.1:${e2eConfig.port}`;
// Local D1 and R2 state of the e2e Worker, wiped before every start so each run begins with an
// empty database. Gitignored by the root `.wrangler/` pattern.
const persistTo = JSON.stringify(path.join(import.meta.dirname, '.wrangler', 'state'));

// A throwaway GitHub App key for this run: the Worker signs installation-token requests with it
// and the stub never checks the signature. Newlines travel as literal "\\n" through `--var`,
// which apps/api/src/config.ts turns back into real ones.
const privateKey = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey.replaceAll('\n', '\\n');
const githubStub = `http://127.0.0.1:${e2eConfig.githubStubPort}`;
const workerVars = {
  ADMIN_TOKEN: e2eConfig.adminToken,
  SESSION_SECRET: e2eConfig.sessionSecret,
  GITHUB_CLIENT_ID: e2eConfig.githubClientId,
  GITHUB_CLIENT_SECRET: e2eConfig.githubClientSecret,
  GITHUB_APP_ID: e2eConfig.githubAppId,
  GITHUB_APP_PRIVATE_KEY: privateKey,
  GITHUB_OAUTH_ORIGIN: githubStub,
  GITHUB_API_ORIGIN: githubStub,
  PUBLIC_URL: baseURL,
};
const varFlags = Object.entries(workerVars)
  .map(([name, value]) => `--var "${name}:${value}"`)
  .join(' ');

const webServerCommand = [
  `rm -rf ${persistTo}`,
  `yarn workspace @targus/api db:migrate:local --persist-to ${persistTo}`,
  'yarn workspace @targus/web build',
  `yarn workspace @targus/api dev --ip 127.0.0.1 --port ${e2eConfig.port} --persist-to ${persistTo} ${varFlags}`,
].join(' && ');

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // Starts the GitHub stub (support/github-stub.ts) the Worker's GitHub origins point at.
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: e2eConfig.isCI,
  // E2E may retry once (docs/engineering-standards.md section 3.4); a test that needed the retry
  // is reported as flaky and must be fixed or quarantined within a week.
  retries: e2eConfig.isCI ? 1 : 0,
  reporter: e2eConfig.isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Apply the migrations to a fresh local D1, build the review UI, then serve it and the API
    // from one local Worker, as in production, with known secrets (ADMIN_TOKEN, SESSION_SECRET,
    // the GitHub App and OAuth credentials) and both GitHub origins pointed at the stub.
    // `@targus/api dev` bundles @targus/core from source via the "development" condition (ADR 0010).
    // The CLI that run.spec.ts drives is built by the `e2e` script before Playwright starts,
    // because the spec imports it at load time.
    command: webServerCommand,
    cwd: repoRoot,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !e2eConfig.isCI,
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
    stdout: e2eConfig.isCI ? 'pipe' : 'ignore',
  },
});
