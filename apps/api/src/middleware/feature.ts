import type { FeatureName } from '@targus/core';
import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../app-env.ts';

/**
 * Put before the handlers of a route that belongs to `name`: while the feature is off the route
 * answers 404, before any authentication, as a route that is not there (ADR 0048).
 */
export function feature(name: FeatureName) {
  return createMiddleware<AppEnv>(async (c, next) => {
    c.var.services.requireFeature(name);
    await next();
  });
}
