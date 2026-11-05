import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { buildStatus } from '../build-status.js';
import { compareSnapshot, type CompareSnapshotInput } from './compare-snapshot.js';

const before = 'a'.repeat(64);
const after = 'b'.repeat(64);
const other = 'c'.repeat(64);

function input(overrides: Partial<CompareSnapshotInput> = {}): CompareSnapshotInput {
  return {
    current: { imageHash: after, unstable: false, error: null },
    baseline: { imageHash: before },
    diffRatio: 0.5,
    threshold: 0.001,
    approvals: [],
    ...overrides,
  };
}

describe('compareSnapshot', () => {
  it('marks a story missing from the build as removed, which needs no review', () => {
    expect(compareSnapshot(input({ current: null }))).toEqual({
      state: 'removed',
      review: 'approved',
    });
  });

  it('marks a story missing from the baseline as new and pending', () => {
    expect(compareSnapshot(input({ baseline: null, diffRatio: null }))).toEqual({
      state: 'new',
      review: 'pending',
    });
  });

  it('auto-approves a new story whose image was approved as new before', () => {
    const approvals = [{ fromHash: null, toHash: after }];

    expect(compareSnapshot(input({ baseline: null, approvals }))).toEqual({
      state: 'new',
      review: 'approved',
    });
  });

  it('does not carry a changed-story approval over to a new story', () => {
    const approvals = [{ fromHash: before, toHash: after }];

    expect(compareSnapshot(input({ baseline: null, approvals })).review).toBe('pending');
  });
});

describe('compareSnapshot against a baseline', () => {
  it('is unchanged when the hashes match, whatever the diff ratio', () => {
    const result = compareSnapshot(input({ baseline: { imageHash: after }, diffRatio: null }));

    expect(result).toEqual({ state: 'unchanged', review: 'approved' });
  });

  it('is unchanged when the diff ratio is at or under the threshold', () => {
    expect(compareSnapshot(input({ diffRatio: 0.001 })).state).toBe('unchanged');
    expect(compareSnapshot(input({ diffRatio: 0 })).state).toBe('unchanged');
    expect(compareSnapshot(input({ diffRatio: 0.0011 })).state).toBe('changed');
  });

  it('is changed when the hashes differ and no diff ratio was computed', () => {
    expect(compareSnapshot(input({ diffRatio: null })).state).toBe('changed');
  });

  it('never blocks on an unstable story', () => {
    const current = { imageHash: after, unstable: true, error: null };

    expect(compareSnapshot(input({ current }))).toEqual({ state: 'unstable', review: 'approved' });
  });

  it('keeps an unstable story unchanged when nothing moved', () => {
    const current = { imageHash: before, unstable: true, error: null };

    expect(compareSnapshot(input({ current })).state).toBe('unchanged');
  });

  it('leaves a change pending without a matching approval', () => {
    const approvals = [
      { fromHash: other, toHash: after },
      { fromHash: before, toHash: other },
      { fromHash: null, toHash: after },
    ];

    expect(compareSnapshot(input({ approvals }))).toEqual({ state: 'changed', review: 'pending' });
  });

  it('auto-approves a change whose exact hash pair was approved before', () => {
    const approvals = [{ fromHash: before, toHash: after }];

    expect(compareSnapshot(input({ approvals }))).toEqual({ state: 'changed', review: 'approved' });
  });
});

describe('compareSnapshot errored stories', () => {
  it('marks a story whose render errored as error, pending but not approvable', () => {
    const current = { imageHash: after, unstable: false, error: 'render timed out' };

    expect(compareSnapshot(input({ current }))).toEqual({ state: 'error', review: 'pending' });
  });

  it('ignores a matching approval and a missing baseline for an errored story', () => {
    const current = { imageHash: after, unstable: true, error: 'render timed out' };
    const approvals = [{ fromHash: null, toHash: after }];

    expect(compareSnapshot(input({ current, baseline: null, approvals }))).toEqual({
      state: 'error',
      review: 'pending',
    });
  });
});

describe('compareSnapshot invalid input', () => {
  it('refuses a story that is in neither the build nor the baseline', () => {
    expect(() => compareSnapshot(input({ current: null, baseline: null }))).toThrow(
      /capture or a baseline/,
    );
  });
});

const hashArb = fc.constantFrom(before, after, other);
const comparisonArb = fc.record({
  fromHash: fc.option(hashArb, { nil: null }),
  toHash: hashArb,
  unstable: fc.boolean(),
  diffRatio: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
  threshold: fc.double({ min: 0, max: 1, noNaN: true }),
});

const errorArb = fc.string({ minLength: 1 });

describe('compareSnapshot properties', () => {
  it('yields error for any capture with a non-null error', () => {
    fc.assert(
      fc.property(comparisonArb, errorArb, (comparison, error) => {
        const { fromHash, toHash, unstable, diffRatio, threshold } = comparison;
        const result = compareSnapshot({
          current: { imageHash: toHash, unstable, error },
          baseline: fromHash === null ? null : { imageHash: fromHash },
          diffRatio,
          threshold,
          approvals: [{ fromHash, toHash }],
        });

        expect(result.state).toBe('error');
      }),
    );
  });

  it('never leaves a story pending once its hash pair is approved', () => {
    fc.assert(
      fc.property(comparisonArb, ({ fromHash, toHash, unstable, diffRatio, threshold }) => {
        const result = compareSnapshot({
          current: { imageHash: toHash, unstable, error: null },
          baseline: fromHash === null ? null : { imageHash: fromHash },
          diffRatio,
          threshold,
          approvals: [{ fromHash, toHash }],
        });

        expect(result.review).not.toBe('pending');
      }),
    );
  });

  it('never yields a pending build when every non-error capture is approved', () => {
    fc.assert(
      fc.property(fc.array(comparisonArb, { maxLength: 10 }), (comparisons) => {
        const snapshots = comparisons.map(({ fromHash, toHash, unstable, diffRatio, threshold }) =>
          compareSnapshot({
            current: { imageHash: toHash, unstable, error: null },
            baseline: fromHash === null ? null : { imageHash: fromHash },
            diffRatio,
            threshold,
            approvals: [{ fromHash, toHash }],
          }),
        );

        expect(buildStatus(snapshots).status).not.toBe('pending');
        expect(buildStatus(snapshots).conclusion).toBe('success');
      }),
    );
  });
});
