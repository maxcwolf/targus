import { describe, expect, it } from 'vitest';

import type { RunBuildOutput } from './run-build.ts';
import { formatRunSummary } from './run-summary.ts';

const output: RunBuildOutput = {
  build: { id: 'b1', number: 7 },
  results: [],
  uploaded: [],
  skipped: [],
  counts: { unchanged: 10, changed: 2, new: 1, removed: 0, unstable: 1, error: 0 },
  response: {
    build: { id: 'b1', number: 7 },
    summary: {
      status: 'pending',
      conclusion: null,
      pendingCount: 3,
      deniedCount: 0,
      errorCount: 0,
    },
    reviewUrl: 'https://targus.test/builds/b1',
    checkRun: { id: 42 },
  },
};

describe('formatRunSummary', () => {
  it('prints a count per state, the status, the review URL and the check run', () => {
    expect(formatRunSummary(output)).toEqual([
      'build: b1',
      'build #7 (b1): pending',
      '  unchanged    10',
      '  changed       2',
      '  new           1',
      '  removed       0',
      '  unstable      1',
      '  error         0',
      '3 to review, 0 denied, 0 errored',
      'review: https://targus.test/builds/b1',
      'check run: 42',
    ]);
  });

  it('lists skipped stories after the counts', () => {
    const lines = formatRunSummary({ ...output, skipped: ['spinner--a', 'spinner--b'] });

    expect(lines[8]).toBe('skipped (2, parameters.targus.skip): spinner--a, spinner--b');
    expect(lines[9]).toBe('3 to review, 0 denied, 0 errored');
  });
});
