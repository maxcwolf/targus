import type { BaselineCandidate } from './resolve-baseline.ts';

/**
 * One row of the shared baseline-resolution table. `resolveBaseline` is tested against it here,
 * and `apps/api` runs the same rows through `BuildRepository.findLatestSuccessfulForShas` so the
 * in-memory rule and the SQL query cannot drift apart.
 */
export interface BaselineResolutionCase {
  readonly name: string;
  readonly mergeBaseSha: string | null;
  readonly ancestors: readonly string[];
  readonly candidates: readonly BaselineCandidate[];
  /** Id of the build that must be chosen, or `null` for no baseline. */
  readonly expectedBuildId: string | null;
}

/** A full 40-character sha made of one repeated hex digit, for readable tables. */
const sha = (digit: string): string => digit.repeat(40);

const mergeBase = sha('a');
const parent = sha('b');
const grandparent = sha('c');

function build(
  id: string,
  onSha: string,
  status: BaselineCandidate['status'],
  createdAt: string,
): BaselineCandidate {
  return { id, sha: onSha, status, createdAt };
}

export const baselineResolutionCases: readonly BaselineResolutionCase[] = [
  {
    name: 'no merge base means no baseline',
    mergeBaseSha: null,
    ancestors: [parent],
    candidates: [build('b1', parent, 'passed', '2026-11-01T00:00:00.000Z')],
    expectedBuildId: null,
  },
  {
    name: 'no candidates means no baseline',
    mergeBaseSha: mergeBase,
    ancestors: [parent],
    candidates: [],
    expectedBuildId: null,
  },
  {
    name: 'a successful build on the merge base wins over an ancestor',
    mergeBaseSha: mergeBase,
    ancestors: [parent],
    candidates: [
      build('b1', parent, 'passed', '2026-11-03T00:00:00.000Z'),
      build('b2', mergeBase, 'accepted', '2026-11-01T00:00:00.000Z'),
    ],
    expectedBuildId: 'b2',
  },
  {
    name: 'the most recent successful build on the sha wins',
    mergeBaseSha: mergeBase,
    ancestors: [],
    candidates: [
      build('b1', mergeBase, 'passed', '2026-11-01T00:00:00.000Z'),
      build('b2', mergeBase, 'accepted', '2026-11-02T00:00:00.000Z'),
      build('b3', mergeBase, 'pending', '2026-11-03T00:00:00.000Z'),
    ],
    expectedBuildId: 'b2',
  },
  {
    name: 'equal createdAt is broken by the greater id',
    mergeBaseSha: mergeBase,
    ancestors: [],
    candidates: [
      build('b2', mergeBase, 'passed', '2026-11-01T00:00:00.000Z'),
      build('b1', mergeBase, 'passed', '2026-11-01T00:00:00.000Z'),
    ],
    expectedBuildId: 'b2',
  },
  {
    name: 'unsuccessful builds on the merge base fall back to the nearest ancestor with one',
    mergeBaseSha: mergeBase,
    ancestors: [parent, grandparent],
    candidates: [
      build('b1', mergeBase, 'denied', '2026-11-04T00:00:00.000Z'),
      build('b2', mergeBase, 'failed', '2026-11-04T00:00:00.000Z'),
      build('b3', mergeBase, 'in_progress', '2026-11-04T00:00:00.000Z'),
      build('b4', grandparent, 'passed', '2026-11-02T00:00:00.000Z'),
      build('b5', parent, 'accepted', '2026-11-01T00:00:00.000Z'),
    ],
    expectedBuildId: 'b5',
  },
  {
    name: 'builds on shas outside the order are ignored',
    mergeBaseSha: mergeBase,
    ancestors: [parent],
    candidates: [build('b1', sha('d'), 'passed', '2026-11-04T00:00:00.000Z')],
    expectedBuildId: null,
  },
];
