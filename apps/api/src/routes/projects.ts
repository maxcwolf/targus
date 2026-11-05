import { TargusError } from '@targus/core';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../app-env.js';
import { sessionAuth } from '../middleware/auth.js';

const BuildsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** `/api/projects/*`: what the review UI lists, behind the session. */
export const projectsRoute = new Hono<AppEnv>()
  .get('/', sessionAuth, async (c) => c.json(await c.var.services.listProjects(c.var.reviewer)))
  .get('/:id/builds', sessionAuth, async (c) => {
    const query = BuildsQuery.safeParse(c.req.query());
    if (!query.success) throw new TargusError('bad_request', 'limit must be an integer 1..100');
    const { services, reviewer } = c.var;
    return c.json(await services.listBuilds(reviewer, c.req.param('id'), query.data.limit));
  });
