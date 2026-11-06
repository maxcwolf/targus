import { z } from 'zod';

// Settings of the Vite dev server (`yarn workspace @targus/web dev`), read by vite.config.ts in
// Node. The only file of apps/web that reads process.env (ESLint no-restricted-properties). The
// name has no VITE_ prefix, so Vite never exposes it to browser code.
const EnvSchema = z.object({
  // Where the dev server proxies /api: `yarn workspace @targus/api dev` by default; set it to
  // `yarn dev:local`'s Worker (http://127.0.0.1:8900) or an e2e Worker.
  TARGUS_API_URL: z
    .url()
    .default('http://localhost:8787')
    .transform((url) => url.replace(/\/+$/, '')),
});

const env = EnvSchema.parse(process.env);

export const devServerConfig = {
  /** Origin of the targus API (the Worker) behind the dev server's `/api` proxy. */
  apiProxyTarget: env.TARGUS_API_URL,
} as const;
