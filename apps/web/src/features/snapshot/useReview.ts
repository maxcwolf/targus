import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ListSnapshotsResponse, ReviewDecision, ReviewSnapshotResponse } from '@targus/core';

import { queryKeys, reviewSnapshot } from '../../api-client/index.js';
import { applyBuildUpdate } from '../build/cache.js';

/** Approve or deny one snapshot, then fold the API's answer into the cached build and list. */
export function useReview(
  buildId: string,
  snapshotId: string,
): UseMutationResult<ReviewSnapshotResponse, Error, ReviewDecision> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (decision: ReviewDecision) => reviewSnapshot(snapshotId, decision),
    onSuccess: (response) => {
      queryClient.setQueryData<ListSnapshotsResponse>(queryKeys.snapshots(buildId), (list) =>
        list
          ? {
              snapshots: list.snapshots.map((snapshot) =>
                snapshot.id === response.snapshot.id ? response.snapshot : snapshot,
              ),
            }
          : list,
      );
      return applyBuildUpdate(queryClient, response);
    },
  });
}
