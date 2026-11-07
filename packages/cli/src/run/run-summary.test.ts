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
    checkRunMissing: null,
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

  it.each([
    ['no_installation', 'check run: none (the project has no GitHub App installation)'],
    ['no_github_app', 'check run: none (the server has no GitHub App configured)'],
    ['failed', 'check run not created: GitHub failed; the next review of this build creates it'],
    ['pending', 'check run: still being created by an earlier attempt or a review'],
    [null, 'check run: none (the project has no GitHub App installation)'],
  ] as const)('says why there is no check run (%s)', (checkRunMissing, line) => {
    const response = { ...output.response, checkRun: null, checkRunMissing };

    expect(formatRunSummary({ ...output, response }).at(-1)).toBe(line);
  });

  it('says to run again when GitHub failed and the build has nothing to review', () => {
    const summary = { ...output.response.summary, status: 'passed' as const, pendingCount: 0 };
    const missing = { checkRun: null, checkRunMissing: 'failed' as const };
    const response = { ...output.response, summary, ...missing };

    expect(formatRunSummary({ ...output, response }).at(-1)).toBe(
      'check run not created: GitHub failed; run `targus run` again to retry',
    );
  });

  it('lists skipped stories after the counts', () => {
    const lines = formatRunSummary({ ...output, skipped: ['spinner--a', 'spinner--b'] });

    expect(lines[8]).toBe('skipped (2, parameters.targus.skip): spinner--a, spinner--b');
    expect(lines[9]).toBe('3 to review, 0 denied, 0 errored');
  });
});
