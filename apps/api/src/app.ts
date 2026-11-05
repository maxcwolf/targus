import { Hono } from 'hono';

import type { AppEnv } from './app-env.js';
import type { Bindings } from './bindings.js';
import { createServices } from './composition.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { adminRoute } from './routes/admin.js';
import { authRoute } from './routes/auth.js';
import { buildsRoute } from './routes/builds.js';
import { healthRoute } from './routes/health.js';
import { imagesRoute } from './routes/images.js';
import { meRoute } from './routes/me.js';
import { projectsRoute } from './routes/projects.js';
import { snapshotsRoute } from './routes/snapshots.js';
import type { Services } from './services/index.js';

/**
 * The API. `makeServices` is the composition root; tests pass one with fakes (for example a
 * stubbed GitHub client) and production uses `createServices`.
 */
export function createApp(
  makeServices: (bindings: Bindings) => Services = createServices,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  app.use('/api/*', async (c, next) => {
    c.set('services', makeServices(c.env));
    await next();
  });
  app.route('/api/health', healthRoute);
  app.route('/api/admin', adminRoute);
  app.route('/api/auth', authRoute);
  app.route('/api/me', meRoute);
  app.route('/api/projects', projectsRoute);
  app.route('/api/builds', buildsRoute);
  app.route('/api/snapshots', snapshotsRoute);
  app.route('/api/images', imagesRoute);
  return app;
}
