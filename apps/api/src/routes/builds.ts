import { CreateBuildRequest, SubmitResultsRequest } from '@targus/core';
import { Hono } from 'hono';

import type { ProjectEnv } from '../app-env.js';
import { projectAuth } from '../middleware/auth.js';
import { jsonBody } from '../middleware/json-body.js';

/**
 * `/api/builds/*`, behind the project token. A build of another project answers 404.
 * The two GET routes move to session auth for the review UI in M3.
 */
export const buildsRoute = new Hono<ProjectEnv>()
  .use(projectAuth)
  .post('/', async (c) => {
    const request = await jsonBody(c, CreateBuildRequest);
    return c.json(await c.var.services.createBuild(c.var.project, request), 201);
  })
  .get('/:id', async (c) => c.json(await c.var.services.getBuild(c.var.project, c.req.param('id'))))
  .get('/:id/snapshots', async (c) =>
    c.json(await c.var.services.listSnapshots(c.var.project, c.req.param('id'))),
  )
  .post('/:id/results', async (c) => {
    const request = await jsonBody(c, SubmitResultsRequest);
    return c.json(await c.var.services.submitResults(c.var.project, c.req.param('id'), request));
  });
