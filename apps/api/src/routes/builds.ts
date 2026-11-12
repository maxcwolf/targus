import { CreateBuildRequest, ReviewSnapshotsRequest, SubmitResultsRequest } from '@targus/core';
import { Hono } from 'hono';

import type { AppEnv } from '../app-env.ts';
import { projectAuth, readerAuth, sessionAuth } from '../middleware/auth.ts';
import { jsonBody } from '../middleware/json-body.ts';

/**
 * `/api/builds/*`. The CLI opens builds and submits results with its project token; the review
 * UI reads builds with its session (the CLI may still read with its token) and approves.
 * A build of another project answers 404; a build outside the reviewer's orgs 403.
 */
export const buildsRoute = new Hono<AppEnv>()
  .post('/', projectAuth, async (c) => {
    const request = await jsonBody(c, CreateBuildRequest);
    return c.json(await c.var.services.createBuild(c.var.project, request), 201);
  })
  .get('/:id', readerAuth, async (c) =>
    c.json(await c.var.services.getBuild(c.var.principal, c.req.param('id'))),
  )
  .get('/:id/snapshots', readerAuth, async (c) =>
    c.json(await c.var.services.listSnapshots(c.var.principal, c.req.param('id'))),
  )
  .post('/:id/results', projectAuth, async (c) => {
    const request = await jsonBody(c, SubmitResultsRequest);
    return c.json(await c.var.services.submitResults(c.var.project, c.req.param('id'), request));
  })
  .post('/:id/review', sessionAuth, async (c) => {
    const request = await jsonBody(c, ReviewSnapshotsRequest);
    const { services, reviewer } = c.var;
    return c.json(await services.reviewSnapshots(reviewer, c.req.param('id'), request));
  })
  .post('/:id/approve-all', sessionAuth, async (c) =>
    c.json(await c.var.services.approveAll(c.var.reviewer, c.req.param('id'))),
  );
