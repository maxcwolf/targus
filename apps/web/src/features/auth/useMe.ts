import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { MeResponse } from '@targus/core';

import { getMe, queryKeys } from '../../api-client/index.js';

/** The signed-in reviewer; the query errors with a 401 `ApiRequestError` when signed out. */
export function useMe(): UseQueryResult<MeResponse> {
  return useQuery({ queryKey: queryKeys.me, queryFn: getMe, staleTime: 5 * 60 * 1000 });
}
