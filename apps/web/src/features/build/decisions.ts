import {
  type Mutation,
  type MutationState,
  type QueryClient,
  useIsMutating,
  useMutationState,
  useQueryClient,
} from '@tanstack/react-query';
import type { ReviewDecision, ReviewSnapshotResponse } from '@targus/core/browser';

/** What one approve or deny sends. */
export interface ReviewVariables {
  readonly snapshotId: string;
  readonly decision: ReviewDecision;
}

/** A decision the API rejected, and why. */
interface FailedDecision extends ReviewVariables {
  readonly error: Error;
}

interface Outcome extends ReviewVariables {
  /** Null while the request is in flight and once it has succeeded. */
  readonly error: Error | null;
}

/**
 * The mutation key of every approve and deny in a build. The decisions stay in the mutation
 * cache after the reviewer moves on, so a failure can be listed on any page of the build.
 */
export function reviewMutationKey(buildId: string): readonly ['review', string] {
  return ['review', buildId];
}

function variablesOf(mutation: Mutation): ReviewVariables | undefined {
  return (mutation.state as MutationState<ReviewSnapshotResponse, Error, ReviewVariables>)
    .variables;
}

function outcomeOf(mutation: Mutation): Outcome | undefined {
  const variables = variablesOf(mutation);
  return variables && { ...variables, error: mutation.state.error };
}

/**
 * Each snapshot's latest decision, if it failed. Outcomes come oldest first (the cache's
 * order), so deciding a snapshot again replaces its failure, whatever the new outcome.
 */
function latestFailures(outcomes: readonly (Outcome | undefined)[]): FailedDecision[] {
  const latest = new Map<string, Outcome>();
  for (const outcome of outcomes) {
    if (outcome) latest.set(outcome.snapshotId, outcome);
  }
  return [...latest.values()].flatMap(({ snapshotId, decision, error }) =>
    error ? [{ snapshotId, decision, error }] : [],
  );
}

function removeSettled(
  queryClient: QueryClient,
  buildId: string,
  snapshotId: string,
  isStale: (mutation: Mutation) => boolean,
): void {
  const cache = queryClient.getMutationCache();
  const settled = cache.findAll({
    mutationKey: reviewMutationKey(buildId),
    predicate: (mutation) =>
      mutation.state.status !== 'pending' &&
      variablesOf(mutation)?.snapshotId === snapshotId &&
      isStale(mutation),
  });
  for (const mutation of settled) cache.remove(mutation);
}

/** Drop every settled decision of a snapshot from the cache, as when its failure is dismissed. */
function forgetDecisions(queryClient: QueryClient, buildId: string, snapshotId: string): void {
  removeSettled(queryClient, buildId, snapshotId, () => true);
}

/**
 * When a decision settles (it is still pending then, so it stays), drop the settled decisions of
 * its snapshot made before it. Only older ones: a newer decision that has already failed is
 * still the snapshot's latest, and an older success must never hide that failure.
 */
export function forgetSupersededDecisions(
  queryClient: QueryClient,
  buildId: string,
  settling: ReviewVariables,
): void {
  const own = queryClient.getMutationCache().find({
    mutationKey: reviewMutationKey(buildId),
    predicate: (mutation) => mutation.state.variables === settling,
  });
  if (!own) return;
  removeSettled(
    queryClient,
    buildId,
    settling.snapshotId,
    (mutation) => mutation.mutationId < own.mutationId,
  );
}

/**
 * Whether a decision on the snapshot is in flight, from any observer: a second decision must
 * wait for the first, or the two could settle in either order.
 */
export function useDecisionInFlight(buildId: string, snapshotId: string): boolean {
  const pending = useIsMutating({
    mutationKey: reviewMutationKey(buildId),
    predicate: (mutation) => variablesOf(mutation)?.snapshotId === snapshotId,
  });
  return pending > 0;
}

/** The build's failed decisions, oldest first, and a way to dismiss one. */
export function useFailedDecisions(buildId: string): {
  readonly failures: readonly FailedDecision[];
  readonly dismiss: (snapshotId: string) => void;
} {
  const queryClient = useQueryClient();
  const outcomes = useMutationState({
    filters: { mutationKey: reviewMutationKey(buildId) },
    select: outcomeOf,
  });
  return {
    failures: latestFailures(outcomes),
    dismiss: (snapshotId) => {
      forgetDecisions(queryClient, buildId, snapshotId);
    },
  };
}
