import type { Hono } from 'hono';

import type { AppEnv } from '../app-env.ts';
import { createApp } from '../app.ts';
import type { Bindings } from './bindings.ts';
import { createWorkerDeps } from './worker-deps.ts';

// Worker entry point (ADR 0023). Only /api/* reaches this code (wrangler.jsonc
// `run_worker_first`); every other path is served from the built web app in apps/web/dist.

const apps = new WeakMap<Bindings, Hono<AppEnv>>();

/** The app for this `env`, built (config validated, adapters created) once per isolate. */
export function appFor(env: Bindings): Hono<AppEnv> {
  const app = apps.get(env) ?? createApp(createWorkerDeps(env));
  apps.set(env, app);
  return app;
}

export default {
  fetch: (request, env) => appFor(env).fetch(request),
} satisfies ExportedHandler<Bindings>;
