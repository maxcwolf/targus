import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ListSnapshotsResponse,
  ReviewDecision,
  ReviewSnapshotResponse,
} from '@targus/core/browser';

import { queryKeys, reviewSnapshot } from '../../api-client/index.ts';
import {
  applyBuildUpdate,
  forgetSupersededDecisions,
  reviewMutationKey,
  type ReviewVariables,
  useDecisionInFlight,
} from '../build/index.ts';

/** The review of the snapshot on screen: whether a decision on it is in flight, and `decide`. */
export interface SnapshotReviewState {
  readonly isPending: boolean;
  readonly decide: (decision: ReviewDecision) => Promise<ReviewSnapshotResponse>;
}

/**
 * Approve or deny one snapshot, then fold the API's answer into the cached build and list. The
 * cache is written before the mutation resolves; the follow-up refetch is not awaited, so a
 * caller that navigates on success does so straight after the cache update.
 *
 * The snapshot page keeps one instance as the reviewer moves between snapshots, and its observer
 * follows only the latest request, so `isPending` asks the mutation cache instead: it is true
 * while any decision on `snapshotId` is in flight, whichever snapshot was decided since. Failures
 * are not reported here: every decision stays in the mutation cache under the build's key, and
 * `FailedDecisions` lists the failed ones wherever the reviewer is in the build.
 */
export function useReview(buildId: string, snapshotId: string): SnapshotReviewState {
  const queryClient = useQueryClient();
  const mutation = useMutation<ReviewSnapshotResponse, Error, ReviewVariables>({
    mutationKey: reviewMutationKey(buildId),
    // Never collected: a failure stays listed until it is dismissed or the story decided again.
    gcTime: Infinity,
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
    // This decision supersedes the snapshot's earlier ones, so the cache keeps one per snapshot.
    onSettled: (_data, _error, variables) => {
      forgetSupersededDecisions(queryClient, buildId, variables);
    },
  });
  const isPending = useDecisionInFlight(buildId, snapshotId);
  return {
    isPending,
    decide: (decision) => mutation.mutateAsync({ snapshotId, decision }),
  };
}
