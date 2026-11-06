import { MeResponse } from '@targus/core/browser';
import { z } from 'zod';

import { getJson, postJson } from './http.ts';

/** `GET /api/me`: the signed-in reviewer. Rejects with a `SignedOutError` when signed out. */
export function getMe(): Promise<MeResponse> {
  return getJson('/api/me', MeResponse);
}

/** `POST /api/auth/logout`: ends the session (204, no body). */
export async function logout(): Promise<void> {
  await postJson('/api/auth/logout', z.null());
}

/**
 * `returnTo` as a same-origin path (path, query and hash), or `/`. A full URL, a
 * protocol-relative `//host` or a backslash trick never reaches the login flow; the API checks
 * again (`safeReturnTo` in apps/api), this keeps the link itself honest.
 */
function samePath(returnTo: string): string {
  if (!returnTo.startsWith('/') || returnTo.startsWith('//') || returnTo.startsWith('/\\')) {
    return '/';
  }
  return returnTo;
}

/**
 * Where the "Sign in with GitHub" link points. A plain navigation, not a fetch: the API
 * redirects to GitHub and back to `returnTo`, the page the reviewer was on.
 */
export function signInUrl(returnTo: string): string {
  return `/api/auth/github?${new URLSearchParams({ returnTo: samePath(returnTo) }).toString()}`;
}
