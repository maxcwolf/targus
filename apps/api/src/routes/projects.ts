import { ListBuildsQuery, maxBuildsPageLimit, TargusError } from '@targus/core';
import { Hono } from 'hono';

import type { AppEnv } from '../app-env.ts';
import { projectAuth, sessionAuth } from '../middleware/auth.ts';

/**
 * `/api/projects/*`: what the review UI lists, behind the session, and `current`, the project a
 * CLI token belongs to (401 for a wrong or revoked token).
 */
export const projectsRoute = new Hono<AppEnv>()
  .get('/', sessionAuth, async (c) => c.json(await c.var.services.listProjects(c.var.reviewer)))
  .get('/current', projectAuth, (c) => c.json(c.var.services.currentProject(c.var.project)))
  .get('/:id/builds', sessionAuth, async (c) => {
    const query = ListBuildsQuery.safeParse(c.req.query());
    if (!query.success) {
      const message = `limit must be an integer 1..${String(maxBuildsPageLimit)}; cursor a string`;
      throw new TargusError('bad_request', message);
    }
    const { services, reviewer } = c.var;
    return c.json(await services.listBuilds(reviewer, c.req.param('id'), query.data));
  })
  .get('/:id/library', sessionAuth, async (c) =>
    c.json(await c.var.services.getLibrary(c.var.reviewer, c.req.param('id'))),
  );
