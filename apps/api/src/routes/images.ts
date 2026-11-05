import { TargusError } from '@targus/core';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import type { ProjectEnv } from '../app-env.js';
import type { ErrorBody } from '../errors.js';
import { projectAuth } from '../middleware/auth.js';

/** Largest PNG the API accepts; a 3x full-screen capture is a few hundred KB. */
export const maxImageBytes = 10 * 1024 * 1024;

const limitImageBody = bodyLimit({
  maxSize: maxImageBytes,
  onError: (c) =>
    c.json<ErrorBody>({ error: { code: 'bad_request', message: 'image larger than 10 MB' } }, 413),
});

/** `/api/images/:hash`: content-addressed PNGs in R2. */
export const imagesRoute = new Hono<ProjectEnv>()
  // TODO(M3): GET moves to session auth so the review UI can load images; PUT stays on the
  // project token.
  .use(projectAuth)
  .put('/:hash', limitImageBody, async (c) => {
    const contentType = c.req.header('content-type')?.split(';')[0]?.trim();
    if (contentType !== 'image/png') {
      throw new TargusError('bad_request', 'Content-Type must be image/png');
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    return c.json(await c.var.services.uploadImage(c.req.param('hash'), bytes));
  })
  .get('/:hash', async (c) => {
    const bytes = await c.var.services.getImage(c.req.param('hash'));
    return c.body(new Uint8Array(bytes), 200, {
      'content-type': 'image/png',
      // Content-addressed: the bytes behind a hash never change.
      'cache-control': 'private, max-age=31536000, immutable',
    });
  });
