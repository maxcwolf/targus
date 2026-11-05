import { CreateProjectRequest } from '@targus/core';
import { Hono } from 'hono';

import type { AppEnv } from '../app-env.js';
import { adminAuth } from '../middleware/auth.js';
import { jsonBody } from '../middleware/json-body.js';

/** `/api/admin/*`, behind the `ADMIN_TOKEN` bearer token. */
export const adminRoute = new Hono<AppEnv>().use(adminAuth).post('/projects', async (c) => {
  const request = await jsonBody(c, CreateProjectRequest);
  return c.json(await c.var.services.createProject(request), 201);
});
