import { Hono } from 'hono';

import type { AppEnv } from '../app-env.ts';

/** `GET /api/health`: HTTP concerns only; the answer comes from the health service. */
export const healthRoute = new Hono<AppEnv>().get('/', (c) => c.json(c.var.services.getHealth()));
