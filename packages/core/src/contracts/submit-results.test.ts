import { describe, expect, it } from 'vitest';

import { StoryResult } from './submit-results.ts';

const result = {
  storyId: 'button--primary',
  state: 'changed',
  imageHash: 'a'.repeat(64),
  width: 1179,
  height: 2556,
  baselineHash: 'b'.repeat(64),
  diffHash: 'c'.repeat(64),
  diffRatio: 0.02,
  error: null,
  blank: false,
};

function issues(story: Record<string, unknown>) {
  const parsed = StoryResult.safeParse(story);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
}

describe('StoryResult baselineHash', () => {
  it('carries the baseline the CLI diffed against', () => {
    expect(StoryResult.parse(result).baselineHash).toBe(result.baselineHash);
  });

  it('is required, so a result that does not say what it diffed against is refused', () => {
    const withoutBaseline = Object.entries(result).filter(([key]) => key !== 'baselineHash');

    expect(issues(Object.fromEntries(withoutBaseline))).toEqual(['baselineHash']);
  });

  it('is null for a story with no baseline, which has no diff either', () => {
    const fresh = { ...result, state: 'new', baselineHash: null };

    expect(issues({ ...fresh, diffHash: null, diffRatio: null })).toEqual([]);
    expect(issues(fresh)).toEqual(['diffRatio', 'diffHash']);
    expect(issues({ ...fresh, diffHash: null })).toEqual(['diffRatio']);
  });

  it('must be a sha256 digest', () => {
    expect(issues({ ...result, baselineHash: 'nope' })).toEqual(['baselineHash']);
  });
});
