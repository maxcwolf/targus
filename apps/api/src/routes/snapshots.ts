import { ReviewRequest } from '@targus/core';
import { Hono } from 'hono';

import type { AppEnv } from '../app-env.js';
import { sessionAuth } from '../middleware/auth.js';
import { jsonBody } from '../middleware/json-body.js';

/** `/api/snapshots/*`: a reviewer's decision on one snapshot. */
export const snapshotsRoute = new Hono<AppEnv>().post('/:id/review', sessionAuth, async (c) => {
  const { decision } = await jsonBody(c, ReviewRequest);
  const { services, reviewer } = c.var;
  return c.json(await services.reviewSnapshot(reviewer, c.req.param('id'), decision));
});
