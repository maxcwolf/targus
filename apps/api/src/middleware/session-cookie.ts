import { TargusError, type TargusErrorCode } from '@targus/core';
import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import { z } from 'zod';

import { sessionLifetimeSeconds, type CookieSettings, type Services } from '../services/index.js';

// Both cookies are signed with SESSION_SECRET, HttpOnly, and SameSite=Lax. Lax keeps the cookie
// off cross-site POSTs; the same-origin check in middleware/auth.ts (ADR 0015) is the CSRF
// defence that does not depend on it, since same-site is wider than same-origin.

const sessionCookie = 'targus_session';
const oauthCookie = 'targus_oauth';
/** How long the browser has to come back from GitHub's consent page. */
const oauthStateSeconds = 600;

const OAuthState = z.object({ state: z.string().min(1), returnTo: z.string().startsWith('/') });
type OAuthState = z.infer<typeof OAuthState>;

function options(settings: CookieSettings, maxAge: number): CookieOptions {
  return { httpOnly: true, sameSite: 'Lax', path: '/', secure: settings.secure, maxAge };
}

/**
 * The request's cookie settings. Without `SESSION_SECRET` there are no sessions, so session
 * routes fail with `code` (401 for API routes, 501 for login).
 */
export function requireCookieSettings(
  services: Pick<Services, 'cookieSettings'>,
  code: TargusErrorCode,
): CookieSettings {
  const settings = services.cookieSettings();
  if (settings === null) throw new TargusError(code, 'sessions are not configured');
  return settings;
}

/** The verified session id, or null when the cookie is missing or its signature is wrong. */
export async function readSessionId(c: Context, settings: CookieSettings): Promise<string | null> {
  const value = await getSignedCookie(c, settings.secret, sessionCookie);
  return typeof value === 'string' && value !== '' ? value : null;
}

export async function writeSessionCookie(
  c: Context,
  settings: CookieSettings,
  sessionId: string,
): Promise<void> {
  const cookieOptions = options(settings, sessionLifetimeSeconds);
  await setSignedCookie(c, sessionCookie, sessionId, settings.secret, cookieOptions);
}

export function clearSessionCookie(c: Context, settings: CookieSettings): void {
  deleteCookie(c, sessionCookie, options(settings, 0));
}

export async function writeOAuthState(
  c: Context,
  settings: CookieSettings,
  value: OAuthState,
): Promise<void> {
  const cookieOptions = options(settings, oauthStateSeconds);
  await setSignedCookie(c, oauthCookie, JSON.stringify(value), settings.secret, cookieOptions);
}

/** Read and clear the OAuth state cookie; null when it is missing, forged or malformed. */
export async function takeOAuthState(
  c: Context,
  settings: CookieSettings,
): Promise<OAuthState | null> {
  const value = await getSignedCookie(c, settings.secret, oauthCookie);
  deleteCookie(c, oauthCookie, options(settings, 0));
  if (typeof value !== 'string') return null;
  try {
    const parsed = OAuthState.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
