import { describe, expect, it, vi } from 'vitest';

import { TargusErrorBoundary, type StoryErrorReport } from './error-boundary.ts';

describe('TargusErrorBoundary.componentDidCatch', () => {
  it('reports null stacks when the error and React give none, and reports only once', () => {
    const report = vi.fn<(error: StoryErrorReport) => void>();
    const boundary = new TargusErrorBoundary({ storyId: 'story--a', report });
    const error = new Error('no stack here');
    delete error.stack;

    boundary.componentDidCatch(error, { componentStack: null });
    boundary.componentDidCatch(new Error('a second throw'), { componentStack: 'in Story' });

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({
      storyId: 'story--a',
      message: 'no stack here',
      stack: null,
      componentStack: null,
    });
  });
});
