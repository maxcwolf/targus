import path from 'node:path';

import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// The Postgres repositories (src/postgres/) and their tests (test/postgres/). They run in Node,
// where a host on Postgres runs them, against PGlite; workerd, where vitest.config.ts runs
// everything else, cannot load it (ADR 0045). The thresholds are the API's own (AGENTS.md) and,
// like them, only go up.
// Unset, the tests run on PGlite in this process. Set (in the environment or a .env file here),
// they run on that Postgres server through node-postgres.
const { TARGUS_TEST_POSTGRES_URL: postgresUrl = null } = loadEnv(
  'test',
  import.meta.dirname,
  'TARGUS_TEST_',
);

export default defineConfig({
  // Workspace packages resolve to their TypeScript source (ADR 0010).
  resolve: { conditions: ['development'] },
  ssr: { resolve: { conditions: ['development'] } },
  test: {
    include: ['test/postgres/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    // The tests are type-checked with the Worker's globals, like the sources they import, so the
    // one path they need is worked out here, where Node's types are.
    provide: {
      postgresMigrationsFolder: path.join(import.meta.dirname, 'migrations-postgres'),
      postgresUrl,
    },
    coverage: {
      provider: 'istanbul',
      reportsDirectory: './coverage/postgres',
      include: ['src/postgres/**/*.ts'],
      thresholds: {
        lines: 97,
        branches: 94,
        functions: 97,
        statements: 97,
      },
    },
  },
});
