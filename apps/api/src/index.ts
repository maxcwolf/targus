import { Hono } from 'hono';

import type { AppEnv } from './bindings.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { healthRoute } from './routes/health.js';

// Worker entry point. Only /api/* reaches this code (wrangler.jsonc `run_worker_first`); every
// other path is served from the built web app in apps/web/dist.
const app = new Hono<AppEnv>();

app.onError(errorHandler);
app.notFound(notFoundHandler);
app.route('/api/health', healthRoute);

export default app;
