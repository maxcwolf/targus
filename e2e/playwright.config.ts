import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

import { e2eConfig } from './config.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const baseURL = `http://127.0.0.1:${e2eConfig.port}`;

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
    // Build the review UI, then serve it and the API from one local Worker, as in production.
    // `@targus/api dev` bundles @targus/core from source via the "development" condition (ADR 0010).
    command: `yarn workspace @targus/web build && yarn workspace @targus/api dev --ip 127.0.0.1 --port ${e2eConfig.port}`,
    cwd: repoRoot,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !e2eConfig.isCI,
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
    stdout: e2eConfig.isCI ? 'pipe' : 'ignore',
  },
});
