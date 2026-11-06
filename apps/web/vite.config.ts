import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

import { devServerConfig } from './config.ts';

// Builds into apps/web/dist, which apps/api serves as Worker static assets (wrangler.jsonc).
export default defineConfig(({ command }) => ({
  plugins: [react()],
  resolve: {
    // `vite` dev resolves workspace packages to their TypeScript source through the "development"
    // export condition (ADR 0010). `vite build` keeps Vite's defaults, which pick "production":
    // @targus/core then comes from its dist/ (the build script runs tsc first), and dependencies
    // that ship a "development" build (@tanstack/react-router, seroval) stay on their production one.
    // Either way the app imports `@targus/core/browser`, which leaves out the Node-only image
    // code: dev serves modules unbundled, so nothing would tree-shake it away (ADR 0025).
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
    // TARGUS_API_URL (config.ts) picks the Worker behind /api, by default
    // `yarn workspace @targus/api dev` on port 8787. The proxy keeps the browser's Origin header,
    // so that Worker's PUBLIC_URL must be this server's origin or review writes answer 403
    // (ADR 0015).
    proxy: { '/api': devServerConfig.apiProxyTarget },
  },
}));
