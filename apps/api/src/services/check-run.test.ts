import type { BuildStatusSummary } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { checkRunState } from './check-run.js';

const base: BuildStatusSummary = {
  status: 'passed',
  conclusion: 'success',
  pendingCount: 0,
  deniedCount: 0,
  errorCount: 0,
};

describe('checkRunState', () => {
  it.each([
    [
      { status: 'pending', conclusion: null, pendingCount: 1 },
      { status: 'in_progress', summary: '1 change awaiting review' },
    ],
    [
      { status: 'pending', conclusion: null, pendingCount: 3 },
      { status: 'in_progress', summary: '3 changes awaiting review' },
    ],
    [{}, { status: 'completed', conclusion: 'success', summary: 'No visual changes' }],
    [
      { status: 'accepted' },
      { status: 'completed', conclusion: 'success', summary: 'All visual changes approved' },
    ],
    [
      { status: 'denied', conclusion: 'failure', deniedCount: 2 },
      { status: 'completed', conclusion: 'failure', summary: '2 changes denied' },
    ],
    [
      { status: 'failed', conclusion: 'failure', errorCount: 1 },
      { status: 'completed', conclusion: 'failure', summary: '1 story failed to render' },
    ],
    [
      { status: 'failed', conclusion: 'failure', errorCount: 2 },
      { status: 'completed', conclusion: 'failure', summary: '2 stories failed to render' },
    ],
  ] as const)('maps %o', (overrides, expected) => {
    expect(checkRunState({ ...base, ...overrides })).toEqual(expected);
  });
});
