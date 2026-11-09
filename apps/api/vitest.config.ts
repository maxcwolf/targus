import path from 'node:path';

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd with the real local D1 and R2 bindings from wrangler.jsonc.
// Coverage thresholds are a guard (docs/engineering-standards.md section 3.1).
// They only go up; a PR that lowers one must say why.
const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));

export default defineConfig({
  // Workspace packages resolve to their TypeScript source through the "development" export
  // condition (ADR 0010). The plugin adds the workerd/worker/module/browser conditions after it.
  resolve: { conditions: ['development'] },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // Tests never need the built web app; an empty assets dir keeps them independent of
        // `yarn workspace @targus/web build`.
        assets: { directory: path.join(import.meta.dirname, 'test/assets') },
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['./test/apply-migrations.ts'],
    coverage: {
      // V8 coverage is not available inside workerd.
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      // schema.ts is declarative; its foreign-key and index callbacks run only in drizzle-kit.
      // The repository tests exercise the tables through the generated migration.
      // src/postgres/ runs in Node, not workerd: vitest.postgres.config.ts tests it and holds it
      // to these same thresholds (ADR 0045).
      exclude: ['src/**/*.test.ts', 'src/db/schema.ts', 'src/postgres/**'],
      thresholds: {
        lines: 97,
        branches: 94,
        functions: 97,
        statements: 97,
      },
    },
  },
});
