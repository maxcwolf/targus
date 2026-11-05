import react from '@vitejs/plugin-react';
import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Coverage thresholds are a guard (docs/engineering-standards.md section 3.1).
// They only go up; a PR that lowers one must say why.
// Workspace packages resolve to their TypeScript source through the "development" export condition
// (ADR 0010). jsdom tests resolve in Vite's client environment, hence the top-level resolve.
export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['development', ...defaultClientConditions] },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // main.tsx only mounts <App /> into index.html; App itself is tested.
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx'],
      thresholds: {
        lines: 70,
        branches: 70,
        functions: 70,
        statements: 70,
      },
    },
  },
});
