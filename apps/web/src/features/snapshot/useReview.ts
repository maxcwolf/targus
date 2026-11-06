import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ListSnapshotsResponse, ReviewDecision, ReviewSnapshotResponse } from '@targus/core';

import { queryKeys, reviewSnapshot } from '../../api-client/index.ts';
import { applyBuildUpdate } from '../build/index.ts';

interface ReviewVariables {
  readonly snapshotId: string;
  readonly decision: ReviewDecision;
}

/** The review of the snapshot on screen: its last request's progress and error, and `decide`. */
export interface SnapshotReviewState {
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly decide: (decision: ReviewDecision) => Promise<ReviewSnapshotResponse>;
}

/**
 * Approve or deny one snapshot, then fold the API's answer into the cached build and list. The
 * cache is written before the mutation resolves; the follow-up refetch is not awaited, so a
 * caller that navigates on success does so straight after the cache update.
 *
 * The snapshot page keeps one instance as the reviewer moves between snapshots, so the request's
 * pending and error state is reported only while `snapshotId` is the snapshot it was made for.
 */
export function useReview(buildId: string, snapshotId: string): SnapshotReviewState {
  const queryClient = useQueryClient();
  const mutation = useMutation<ReviewSnapshotResponse, Error, ReviewVariables>({
    mutationFn: (variables) => reviewSnapshot(variables.snapshotId, variables.decision),
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
      void applyBuildUpdate(queryClient, response);
    },
  });
  const own = mutation.variables?.snapshotId === snapshotId;
  return {
    isPending: own && mutation.isPending,
    error: own ? mutation.error : null,
    decide: (decision) => mutation.mutateAsync({ snapshotId, decision }),
  };
}
