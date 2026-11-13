import type { MeResponse } from '@targus/core';
import { Hono } from 'hono';

import type { AppEnv } from '../app-env.ts';
import { sessionAuth } from '../middleware/auth.ts';

/** `GET /api/me`: the signed-in reviewer and the features that are on, or 401. */
export const meRoute = new Hono<AppEnv>().get('/', sessionAuth, (c) =>
  c.json<MeResponse>({ user: c.var.reviewer.user, features: c.var.services.featureFlags() }),
);
