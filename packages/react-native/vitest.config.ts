import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Coverage thresholds are a guard (docs/engineering-standards.md section 3.1).
// They only go up; a PR that lowers one must say why.
//
// These tests run in plain Node. react-native itself is a peer dependency and is deliberately
// not installed here, so the decorator and its error boundary are rendered with
// react-test-renderer, which needs no react-native.
// Workspace packages resolve to their TypeScript source through the "development" export condition
// (ADR 0010), so tests never need a build. Node-environment tests resolve in Vite's ssr
// environment, so the condition goes in ssr.resolve, not the top-level resolve.
export default defineConfig({
  ssr: { resolve: { conditions: ['development', ...defaultServerConditions] } },
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: {
        lines: 98,
        branches: 89,
        functions: 98,
        statements: 94,
      },
    },
  },
});
