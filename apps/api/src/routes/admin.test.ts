import { CreateProjectResponse } from '@targus/core';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { adminToken, call, postJson } from '../../test/support/api.ts';

const body = {
  githubOrg: 'admin-org',
  installationId: 5,
  repo: 'admin-org/admin-app',
  name: 'admin app',
};

describe('POST /api/admin/projects', () => {
  it('creates a project and returns its token once, matching the contract', async () => {
    const response = await postJson('/api/admin/projects', adminToken, body);

    expect(response.status).toBe(201);
    const parsed = CreateProjectResponse.parse(await response.json());
    expect(parsed.project).toMatchObject({ repo: 'admin-org/admin-app', defaultBranch: 'main' });

    const again = await postJson('/api/admin/projects', adminToken, body);
    expect(again.status).toBe(409);
  });

  it('requires the admin token', async () => {
    expect((await call('/api/admin/projects', { method: 'POST' })).status).toBe(401);
    expect((await postJson('/api/admin/projects', 'wrong', body)).status).toBe(401);
  });

  it('is disabled when ADMIN_TOKEN is not set', async () => {
    const response = await exports.default.fetch('http://targus.test/api/admin/projects', {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: 'unauthorized',
        message: 'admin API is disabled',
        requestId: response.headers.get('x-request-id'),
      },
    });
  });

  it('rejects invalid bodies with 400', async () => {
    const invalid = await postJson('/api/admin/projects', adminToken, { ...body, repo: 'nope' });
    const notJson = await call('/api/admin/projects', {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: '{',
    });

    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: 'bad_request' } });
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toEqual({
      error: {
        code: 'bad_request',
        message: 'request body is not valid JSON',
        requestId: notJson.headers.get('x-request-id'),
      },
    });
  });
});
