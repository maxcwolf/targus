import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { forgetSupersededDecisions, reviewMutationKey, type ReviewVariables } from './decisions.ts';

/** Run one decision of build-1 through the cache; `outcome` is what its request answers. */
async function decide(
  queryClient: QueryClient,
  variables: ReviewVariables,
  outcome: () => Promise<unknown>,
): Promise<void> {
  const mutation = queryClient
    .getMutationCache()
    .build<unknown, Error, ReviewVariables, unknown>(queryClient, {
      mutationKey: reviewMutationKey('build-1'),
      gcTime: Infinity,
      mutationFn: outcome,
    });
  await mutation.execute(variables).catch(() => undefined);
}

const decisionsOf = (queryClient: QueryClient): (ReviewVariables | undefined)[] =>
  queryClient
    .getMutationCache()
    .getAll()
    .map((mutation) => mutation.state.variables as ReviewVariables | undefined);

describe('forgetSupersededDecisions', () => {
  it('forgets only decisions of the snapshot older than the one settling', async () => {
    const queryClient = new QueryClient();
    const older = { snapshotId: 'snap-1', decision: 'approve' } as const;
    const other = { snapshotId: 'snap-2', decision: 'deny' } as const;
    const settling = { snapshotId: 'snap-1', decision: 'deny' } as const;
    const newer = { snapshotId: 'snap-1', decision: 'approve' } as const;
    await decide(queryClient, older, () => Promise.reject(new Error('busy')));
    await decide(queryClient, other, () => Promise.reject(new Error('busy')));
    await decide(queryClient, settling, () => Promise.resolve({}));
    await decide(queryClient, newer, () => Promise.reject(new Error('busy')));

    forgetSupersededDecisions(queryClient, 'build-1', settling);

    expect(decisionsOf(queryClient)).toEqual([other, settling, newer]);
  });

  it('forgets nothing for a decision the cache does not hold', async () => {
    const queryClient = new QueryClient();
    const failed = { snapshotId: 'snap-1', decision: 'approve' } as const;
    await decide(queryClient, failed, () => Promise.reject(new Error('busy')));

    forgetSupersededDecisions(queryClient, 'build-1', { snapshotId: 'snap-1', decision: 'deny' });

    expect(decisionsOf(queryClient)).toEqual([failed]);
  });
});
