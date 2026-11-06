import { TargusError, targusErrorCodes } from '@targus/core';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it, vi } from 'vitest';

import type { AppEnv } from './app-env.ts';
import { errorHandler, httpStatusFor } from './errors.ts';

function appThrowing(error: unknown): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(errorHandler);
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
  it('maps a TargusError code to its status with a JSON body', async () => {
    const response = await appThrowing(new TargusError('conflict', 'already exists')).request('/');

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'conflict', message: 'already exists' },
    });
  });

  it('passes HTTPException responses through', async () => {
    const response = await appThrowing(new HTTPException(418, { message: 'teapot' })).request('/');

    expect(response.status).toBe(418);
  });

  it('hides unknown errors behind a 500', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await appThrowing(new Error('secret detail')).request('/');

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'internal', message: 'Internal Server Error' },
    });
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
