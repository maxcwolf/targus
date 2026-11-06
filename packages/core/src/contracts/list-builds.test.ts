import { describe, expect, it } from 'vitest';

import { ListBuildsQuery, ListBuildsResponse, maxBuildsPageLimit } from './index.js';

describe('ListBuildsQuery', () => {
  it('accepts no query at all, as clients that do not page send', () => {
    expect(ListBuildsQuery.parse({})).toEqual({});
  });

  it('coerces the limit from a query string and keeps the cursor', () => {
    expect(ListBuildsQuery.parse({ limit: '25', cursor: 'bjoxMg' })).toEqual({
      limit: 25,
      cursor: 'bjoxMg',
    });
  });

  it('rejects a limit outside 1..max and an empty or oversized cursor', () => {
    for (const limit of ['0', String(maxBuildsPageLimit + 1), '1.5', 'abc']) {
      expect(ListBuildsQuery.safeParse({ limit }).success).toBe(false);
    }
    expect(ListBuildsQuery.safeParse({ cursor: '' }).success).toBe(false);
    expect(ListBuildsQuery.safeParse({ cursor: 'x'.repeat(129) }).success).toBe(false);
  });
});

describe('ListBuildsResponse', () => {
  it('reads a body without nextCursor as the last page', () => {
    expect(ListBuildsResponse.parse({ builds: [] })).toEqual({ builds: [], nextCursor: null });
  });

  it('keeps a next cursor and rejects an empty one', () => {
    expect(ListBuildsResponse.parse({ builds: [], nextCursor: 'bjoxMg' }).nextCursor).toBe(
      'bjoxMg',
    );
    expect(ListBuildsResponse.safeParse({ builds: [], nextCursor: '' }).success).toBe(false);
  });
});
