import { QueryClient } from '@tanstack/react-query';

import { ApiRequestError } from '../api-client/index.js';

/** 4xx answers are final (signed out, no access, not found); only retry other failures. */
function shouldRetry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiRequestError && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: shouldRetry } } });
}
