import { Hono } from 'hono';

import type { AppEnv } from '../app-env.js';
import { sessionAuth } from '../middleware/auth.js';
import {
  clearSessionCookie,
  requireCookieSettings,
  takeOAuthState,
  writeOAuthState,
  writeSessionCookie,
} from '../middleware/session-cookie.js';

/**
 * `/api/auth/*`: GitHub login through the targus App's OAuth flow (plan.md section 5.2). The
 * state travels in a signed short-lived cookie; the session is a signed HttpOnly cookie.
 */
export const authRoute = new Hono<AppEnv>()
  .get('/github', async (c) => {
    const settings = requireCookieSettings(c.var.services, 'not_implemented');
    const login = c.var.services.beginLogin(c.req.query('returnTo'));
    await writeOAuthState(c, settings, { state: login.state, returnTo: login.returnTo });
    return c.redirect(login.url, 302);
  })
  .get('/github/callback', async (c) => {
    const settings = requireCookieSettings(c.var.services, 'not_implemented');
    const saved = await takeOAuthState(c, settings);
    const session = await c.var.services.completeLogin({
      code: c.req.query('code'),
      state: c.req.query('state'),
      expectedState: saved?.state ?? null,
    });
    await writeSessionCookie(c, settings, session.sessionId);
    return c.redirect(saved?.returnTo ?? '/', 302);
  })
  .post('/logout', sessionAuth, async (c) => {
    await c.var.services.logout(c.var.reviewer.sessionId);
    clearSessionCookie(c, requireCookieSettings(c.var.services, 'unauthorized'));
    return c.body(null, 204);
  });
