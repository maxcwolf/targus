import type { BuildStatusSummary } from '@targus/core/browser';
import { describe, expect, it } from 'vitest';

import { initialSnapshots } from '../../test/fixtures.ts';
import { componentTitle, effectiveFilter, groupByTitle, validateFilterSearch } from './filters.ts';
import { summaryLine } from './summary.ts';

const summary = (fields: Partial<BuildStatusSummary>): BuildStatusSummary => ({
  status: 'pending',
  conclusion: null,
  pendingCount: 0,
  deniedCount: 0,
  errorCount: 0,
  ...fields,
});

describe('filters', () => {
  it('keeps only known filters from the search string', () => {
    expect(validateFilterSearch({ filter: 'new' })).toEqual({ filter: 'new' });
    expect(validateFilterSearch({ filter: 'bogus' })).toEqual({});
    expect(validateFilterSearch({})).toEqual({});
  });

  it('defaults to unreviewed only when something is pending', () => {
    const snapshots = initialSnapshots();
    expect(effectiveFilter(undefined, snapshots)).toBe('unreviewed');
    expect(effectiveFilter('removed', snapshots)).toBe('removed');
    expect(effectiveFilter(undefined, [])).toBe('all');
  });

  it('groups by title, falling back to the story id prefix', () => {
    const groups = groupByTitle(initialSnapshots());
    expect(groups.map((group) => group.title)).toEqual([
      'Avatar',
      'Button',
      'Card',
      'legacy',
      'Text',
      'Chart',
      'Spinner',
    ]);
    const [first] = initialSnapshots();
    if (!first) throw new Error('fixture missing');
    expect(componentTitle({ ...first, title: null, storyId: 'plain' })).toBe('plain');
  });
});

describe('summaryLine', () => {
  it('describes every build status', () => {
    expect(summaryLine(summary({ pendingCount: 1 }))).toBe('1 change awaiting review');
    expect(summaryLine(summary({ status: 'denied', deniedCount: 2 }))).toBe('2 changes denied');
    expect(summaryLine(summary({ status: 'denied', deniedCount: 1, pendingCount: 3 }))).toBe(
      '1 change denied, 3 awaiting review',
    );
    expect(summaryLine(summary({ status: 'accepted' }))).toBe('All changes approved');
    expect(summaryLine(summary({ status: 'passed' }))).toBe('No visual changes');
    expect(summaryLine(summary({ status: 'failed', errorCount: 2 }))).toBe(
      '2 stories failed to render; a later build must fix them',
    );
  });
});
