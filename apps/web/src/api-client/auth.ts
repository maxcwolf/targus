import { MeResponse } from '@targus/core';
import { z } from 'zod';

import { getJson, postJson } from './http.js';

/** `GET /api/me`: the signed-in reviewer. Rejects with a 401 `ApiRequestError` when signed out. */
export function getMe(): Promise<MeResponse> {
  return getJson('/api/me', MeResponse);
}

/** `POST /api/auth/logout`: ends the session (204, no body). */
export async function logout(): Promise<void> {
  await postJson('/api/auth/logout', z.null());
}

/**
 * Where the "Sign in with GitHub" link points. A plain navigation, not a fetch: the API
 * redirects to GitHub and back to `returnTo`.
 */
export function signInUrl(returnTo: string): string {
  return `/api/auth/github?${new URLSearchParams({ returnTo }).toString()}`;
}
