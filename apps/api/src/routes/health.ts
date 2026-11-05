import { Hono } from 'hono';

import type { AppEnv } from '../bindings.js';
import { loadConfig } from '../config.js';
import { getHealth } from '../services/health.service.js';

/** `GET /api/health`: HTTP concerns only; the answer comes from the health service. */
export const healthRoute = new Hono<AppEnv>().get('/', (c) => c.json(getHealth(loadConfig(c.env))));
