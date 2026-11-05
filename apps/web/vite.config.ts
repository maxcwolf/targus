import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

// Builds into apps/web/dist, which apps/api serves as Worker static assets (wrangler.jsonc).
export default defineConfig(({ command }) => ({
  plugins: [react()],
  resolve: {
    // `vite` dev resolves workspace packages to their TypeScript source through the "development"
    // export condition (ADR 0010). `vite build` keeps Vite's defaults, which pick "production":
    // @targus/core then comes from its dist/ (the build script runs tsc first), and dependencies
    // that ship a "development" build (@tanstack/react-router, seroval) stay on their production one.
    conditions:
      command === 'serve'
        ? ['development', ...defaultClientConditions]
        : [...defaultClientConditions],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    // `yarn dev` here plus `yarn workspace @targus/api dev` gives a local stack.
    proxy: { '/api': 'http://localhost:8787' },
  },
}));
