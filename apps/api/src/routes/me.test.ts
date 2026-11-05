import { MeResponse } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { call } from '../../test/support/api.js';
import { signIn, withCookie } from '../../test/support/session.js';

describe('GET /api/me', () => {
  it('answers the signed-in user, matching the contract', async () => {
    const { cookie, user } = await signIn('octocat');

    const response = await call('/api/me', { headers: withCookie(cookie) });

    expect(response.status).toBe(200);
    expect(MeResponse.parse(await response.json())).toEqual({ user });
  });

  it('answers 401 without a cookie, with a forged one and with an unknown session', async () => {
    const { cookie } = await signIn('octocat');
    const forged = `${cookie.slice(0, cookie.indexOf('.'))}.AAAA`;

    for (const headers of [{}, withCookie(forged), withCookie('targus_session=plain')]) {
      const response = await call('/api/me', { headers });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: 'unauthorized' } });
    }
  });
});
