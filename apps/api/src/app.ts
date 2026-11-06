import { Hono } from 'hono';

import type { AppEnv } from './app-env.ts';
import { systemObservability, type AppDeps } from './composition.ts';
import { errorHandler, notFoundHandler } from './errors.ts';
import { requestLogger, type Observability } from './middleware/request-log.ts';
import { adminRoute } from './routes/admin.ts';
import { authRoute } from './routes/auth.ts';
import { buildsRoute } from './routes/builds.ts';
import { healthRoute } from './routes/health.ts';
import { imagesRoute } from './routes/images.ts';
import { meRoute } from './routes/me.ts';
import { projectsRoute } from './routes/projects.ts';
import { snapshotsRoute } from './routes/snapshots.ts';
import { bindServices } from './services/index.ts';

/**
 * The API, built from plain dependencies (ADR 0023): no host type reaches it, so any entry that
 * can build `AppDeps` can serve it. `deps` live as long as the app (once per isolate on the
 * Worker); only the request log, and the services bound to it, are made per request. `observe`
 * supplies request ids, time and the log sink; tests pass fakes and a logger that keeps lines.
 */
export function createApp(
  deps: AppDeps,
  observe: Observability = systemObservability,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  app.use(requestLogger(observe));
  app.use('/api/*', async (c, next) => {
    c.set('services', bindServices({ ...deps, log: c.var.log }));
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
