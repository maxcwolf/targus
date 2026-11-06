import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

import { e2eConfig } from './config.ts';
import { repoRoot } from './support/cli.ts';
import { workerDevCommand, workerEnv, workerSetupCommands } from './support/local-worker.ts';

const baseURL = `http://127.0.0.1:${e2eConfig.port}`;
const worker = {
  port: e2eConfig.port,
  githubStubPort: e2eConfig.githubStubPort,
  publicUrl: baseURL,
  // Wiped before every start so each run begins with an empty database.
  persistTo: path.join(import.meta.dirname, '.wrangler', 'state'),
  // apps/web/dist, the folder wrangler.jsonc serves.
  webOutDir: null,
};
const webServerCommand = [...workerSetupCommands(worker), workerDevCommand(worker)].join(' && ');

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
    env: workerEnv,
    stdout: e2eConfig.isCI ? 'pipe' : 'ignore',
  },
});
