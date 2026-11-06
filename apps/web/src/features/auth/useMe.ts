import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import type { MeResponse } from '@targus/core';
import { createContext, useContext } from 'react';

import { getMe, isSignedOut, queryKeys } from '../../api-client/index.js';

/** The signed-in reviewer; the query errors with a `SignedOutError` when signed out. */
export function useMe(): UseQueryResult<MeResponse> {
  return useQuery({ queryKey: queryKeys.me, queryFn: getMe, staleTime: 5 * 60 * 1000 });
}

/**
 * True when the session ended mid-visit: `me` had loaded the reviewer, then a refetch (started
 * by any 401, see app/query-client.ts) answered signed out. A first visit without a session is
 * not "expired"; `me` has no data then.
 */
export function isSessionExpired(me: UseQueryResult<MeResponse>): boolean {
  return me.data !== undefined && me.isError && isSignedOut(me.error);
}

/**
 * The auth gate's `isSessionExpired`, for the pages below it. A context rather than another
 * `useMe()`: a new observer of a failed `me` query refetches it on mount, which would loop.
 */
export const SessionExpiredContext = createContext(false);

export function useSessionExpired(): boolean {
  return useContext(SessionExpiredContext);
}

/** The current page as a same-origin path with query and hash, for the login's `returnTo`. */
export function useReturnTo(): string {
  return useRouterState({ select: (state) => state.location.href });
}
