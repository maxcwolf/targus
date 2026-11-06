import { TargusError, targusErrorCodes } from '@targus/core';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';

import { createCapturingLogger, fakeObservability } from '../test/support/logs.ts';
import type { AppEnv } from './app-env.ts';
import { errorHandler, httpStatusFor } from './errors.ts';
import { requestLogger } from './middleware/request-log.ts';

function appThrowing(error: unknown, logger = createCapturingLogger()): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(errorHandler);
  app.use(requestLogger(fakeObservability(logger)));
  app.get('/', () => {
    throw error;
  });
  return app;
}

describe('httpStatusFor', () => {
  it.each(targusErrorCodes)('maps %s to an HTTP error status', (code) => {
    const status = httpStatusFor(code);

    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(600);
  });
});

describe('errorHandler', () => {
  it('maps a TargusError code to its status with a JSON body carrying the request id', async () => {
    const response = await appThrowing(new TargusError('conflict', 'already exists')).request('/');

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'conflict', message: 'already exists', requestId: 'req-1' },
    });
  });

  it('passes HTTPException responses through', async () => {
    const response = await appThrowing(new HTTPException(418, { message: 'teapot' })).request('/');

    expect(response.status).toBe(418);
  });

  it('hides unknown errors behind a 500 and leaves their detail to the log line', async () => {
    const logger = createCapturingLogger();
    const response = await appThrowing(new Error('secret detail'), logger).request('/');

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'internal', message: 'Internal Server Error', requestId: 'req-1' },
    });
    expect(logger.entries).toEqual([
      expect.objectContaining({
        level: 'error',
        status: 500,
        error: { code: 'internal', message: 'secret detail', stack: expect.any(String) as unknown },
      }),
    ]);
  });
});
