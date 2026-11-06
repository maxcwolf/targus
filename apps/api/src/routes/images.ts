import { TargusError } from '@targus/core';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import type { AppEnv } from '../app-env.js';
import type { ErrorBody } from '../errors.js';
import { projectAuth, readerAuth } from '../middleware/auth.js';

/** Largest PNG the API accepts; a 3x full-screen capture is a few hundred KB. */
export const maxImageBytes = 10 * 1024 * 1024;

const limitImageBody = bodyLimit({
  maxSize: maxImageBytes,
  onError: (c) =>
    c.json<ErrorBody>({ error: { code: 'bad_request', message: 'image larger than 10 MB' } }, 413),
});

/**
 * `/api/images/:hash`: content-addressed PNGs in R2. The CLI uploads (and downloads baselines)
 * with its project token; the review UI's `<img>` tags read with the session cookie.
 */
export const imagesRoute = new Hono<AppEnv>()
  .put('/:hash', projectAuth, limitImageBody, async (c) => {
    const contentType = c.req.header('content-type')?.split(';')[0]?.trim();
    if (contentType !== 'image/png') {
      throw new TargusError('bad_request', 'Content-Type must be image/png');
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    return c.json(await c.var.services.uploadImage(c.var.project, c.req.param('hash'), bytes));
  })
  .get('/:hash', readerAuth, async (c) => {
    const bytes = await c.var.services.getImage(c.var.principal, c.req.param('hash'));
    return c.body(new Uint8Array(bytes), 200, {
      'content-type': 'image/png',
      // Content-addressed: the bytes behind a hash never change.
      'cache-control': 'private, max-age=31536000, immutable',
    });
  });
