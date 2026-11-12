import { describe, expect, it } from 'vitest';

import {
  defaultStoryHistoryLimit,
  GetStoryHistoryQuery,
  maxStoryHistoryLimit,
} from './story-history.ts';

describe('GetStoryHistoryQuery', () => {
  it('defaults the variant and the limit, and reads the limit from query text', () => {
    expect(GetStoryHistoryQuery.parse({ storyId: 'button--primary', platform: 'web' })).toEqual({
      storyId: 'button--primary',
      variant: 'default',
      platform: 'web',
      limit: defaultStoryHistoryLimit,
    });
    expect(
      GetStoryHistoryQuery.parse({ storyId: 'a', variant: 'ax5', platform: 'ios', limit: '5' }),
    ).toMatchObject({ variant: 'ax5', limit: 5 });
  });

  it('needs a story and a known platform, and a limit in range', () => {
    const valid = { storyId: 'a', platform: 'ios' };
    for (const query of [
      { platform: 'ios' },
      { storyId: '', platform: 'ios' },
      { storyId: 'a' },
      { storyId: 'a', platform: 'macos' },
      { ...valid, limit: '0' },
      { ...valid, limit: String(maxStoryHistoryLimit + 1) },
      { ...valid, limit: '1.5' },
    ]) {
      expect(GetStoryHistoryQuery.safeParse(query).success).toBe(false);
    }
  });
});
