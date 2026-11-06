import { createApp } from './app.ts';

// Worker entry point. Only /api/* reaches this code (wrangler.jsonc `run_worker_first`); every
// other path is served from the built web app in apps/web/dist.
export default createApp();
