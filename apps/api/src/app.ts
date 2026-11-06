import { Hono } from 'hono';

import type { AppEnv } from './app-env.ts';
import type { Bindings } from './bindings.ts';
import { createServices } from './composition.ts';
import { errorHandler, notFoundHandler } from './errors.ts';
import { adminRoute } from './routes/admin.ts';
import { authRoute } from './routes/auth.ts';
import { buildsRoute } from './routes/builds.ts';
import { healthRoute } from './routes/health.ts';
import { imagesRoute } from './routes/images.ts';
import { meRoute } from './routes/me.ts';
import { projectsRoute } from './routes/projects.ts';
import { snapshotsRoute } from './routes/snapshots.ts';
import type { Services } from './services/index.ts';

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
