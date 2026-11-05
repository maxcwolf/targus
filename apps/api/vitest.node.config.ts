import { defineConfig } from 'vitest/config';

// Node-side tests that cannot run inside workerd (the migration drift guard spawns drizzle-kit).
// Everything else runs in vitest.config.ts against the Workers runtime.
export default defineConfig({
  test: {
    include: ['test/node/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
