import type { MeResponse } from '@targus/core';
import { Hono } from 'hono';

import type { AppEnv } from '../app-env.js';
import { sessionAuth } from '../middleware/auth.js';

/** `GET /api/me`: the signed-in reviewer, or 401. */
export const meRoute = new Hono<AppEnv>().get('/', sessionAuth, (c) =>
  c.json<MeResponse>({ user: c.var.reviewer.user }),
);
