import { MutationCache, QueryCache, QueryClient, type QueryKey } from '@tanstack/react-query';

import { ApiRequestError, isSignedOut, queryKeys } from '../api-client/index.ts';

/** 4xx answers are final (signed out, no access, not found); only retry other failures. */
function shouldRetry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiRequestError && error.status < 500) return false;
  return failureCount < 2;
}

const isMe = (queryKey: QueryKey): boolean =>
  queryKey.length === queryKeys.me.length && queryKey[0] === queryKeys.me[0];

/**
 * The one place a 401 is handled. Any query or mutation that finds the session gone re-asks
 * `GET /api/me`; its 401 then flips the auth gate to the signed-out state while the page,
 * and the failed action's error, stay on screen. `me` itself is skipped, or its own 401
 * would refetch it forever.
 */
function onSignedOut(queryClient: QueryClient, error: Error, queryKey?: QueryKey): void {
  if (!isSignedOut(error) || (queryKey !== undefined && isMe(queryKey))) return;
  void queryClient.invalidateQueries({ queryKey: queryKeys.me, exact: true });
}

export interface QueryClientOptions {
  /** Tests pass `false` so error states are reached without retry delays. */
  readonly retry?: false;
}

export function createQueryClient(options: QueryClientOptions = {}): QueryClient {
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        onSignedOut(queryClient, error, query.queryKey);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        onSignedOut(queryClient, error);
      },
    }),
    defaultOptions: { queries: { retry: options.retry ?? shouldRetry } },
  });
  return queryClient;
}
