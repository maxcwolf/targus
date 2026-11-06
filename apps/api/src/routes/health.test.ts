import { HealthResponse } from '@targus/core';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('GET /api/health', () => {
  it('answers ok with the deployed version, matching the shared contract', async () => {
    const response = await exports.default.fetch('http://targus.test/api/health');

    expect(response.status).toBe(200);
    expect(HealthResponse.parse(await response.json())).toEqual({
      ok: true,
      version: env.APP_VERSION,
    });
  });

  it('answers unknown API routes with a JSON 404', async () => {
    const response = await exports.default.fetch('http://targus.test/api/nope');

    expect(response.status).toBe(404);
    const requestId = response.headers.get('x-request-id');
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'No route for GET /api/nope', requestId },
    });
  });
});
