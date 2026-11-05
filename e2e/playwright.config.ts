import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

import { e2eConfig } from './config.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const baseURL = `http://127.0.0.1:${e2eConfig.port}`;
// Local D1 and R2 state of the e2e Worker, wiped before every start so each run begins with an
// empty database. Gitignored by the root `.wrangler/` pattern.
const persistTo = JSON.stringify(path.join(import.meta.dirname, '.wrangler', 'state'));

const webServerCommand = [
  `rm -rf ${persistTo}`,
  `yarn workspace @targus/api db:migrate:local --persist-to ${persistTo}`,
  'yarn workspace @targus/web build',
  `yarn workspace @targus/api dev --ip 127.0.0.1 --port ${e2eConfig.port} --persist-to ${persistTo} --var ADMIN_TOKEN:${e2eConfig.adminToken}`,
].join(' && ');

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
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
    // from one local Worker, as in production, with a known ADMIN_TOKEN for the admin route.
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
