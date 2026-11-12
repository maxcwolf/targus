import { describe, expect, it } from 'vitest';

import { maxReviewSnapshots, ReviewSnapshotsRequest } from './review.ts';

describe('ReviewSnapshotsRequest', () => {
  it('takes a decision and the snapshots it applies to', () => {
    const request = { decision: 'deny', snapshotIds: ['a', 'b'] };
    expect(ReviewSnapshotsRequest.parse(request)).toEqual(request);
  });

  it('needs at least one snapshot, at most the limit, and a known decision', () => {
    const ids = (count: number): string[] =>
      Array.from({ length: count }, (_, i) => `s${String(i)}`);
    const parses = (request: unknown): boolean => ReviewSnapshotsRequest.safeParse(request).success;

    expect(parses({ decision: 'approve', snapshotIds: ids(maxReviewSnapshots) })).toBe(true);
    expect(parses({ decision: 'approve', snapshotIds: ids(maxReviewSnapshots + 1) })).toBe(false);
    expect(parses({ decision: 'approve', snapshotIds: [] })).toBe(false);
    expect(parses({ decision: 'approve', snapshotIds: [''] })).toBe(false);
    expect(parses({ decision: 'maybe', snapshotIds: ['a'] })).toBe(false);
    expect(parses({ decision: 'approve' })).toBe(false);
  });
});
