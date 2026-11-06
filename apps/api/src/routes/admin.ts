import { CreateProjectRequest } from '@targus/core';
import { Hono } from 'hono';

import type { AppEnv } from '../app-env.ts';
import { adminAuth } from '../middleware/auth.ts';
import { jsonBody } from '../middleware/json-body.ts';

/** `/api/admin/*`, behind the `ADMIN_TOKEN` bearer token. */
export const adminRoute = new Hono<AppEnv>().use(adminAuth).post('/projects', async (c) => {
  const request = await jsonBody(c, CreateProjectRequest);
  return c.json(await c.var.services.createProject(request), 201);
});
