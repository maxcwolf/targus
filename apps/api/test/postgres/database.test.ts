import { describe, expect, it } from 'vitest';

import {
  chunkForPostgres,
  postgresMaxBoundParameters,
  returned,
} from '../../src/postgres/database.ts';

describe('chunkForPostgres', () => {
  it('keeps every statement within the parameters Postgres binds', () => {
    const rows = Array.from({ length: 10 }, (_, index) => index);
    const perRow = Math.floor(postgresMaxBoundParameters / 4);

    expect(chunkForPostgres(rows, perRow)).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9],
    ]);
    expect(chunkForPostgres(rows, 1)).toEqual([rows]);
    expect(chunkForPostgres([], 18)).toEqual([]);
  });

  it('sends a row wider than the limit on its own rather than not at all', () => {
    expect(chunkForPostgres(['a', 'b'], postgresMaxBoundParameters + 1)).toEqual([['a'], ['b']]);
  });
});

describe('returned', () => {
  it('gives the row of a statement that returned one', () => {
    expect(returned([{ id: 'a' }])).toEqual({ id: 'a' });
  });

  it('throws when the statement returned none', () => {
    expect(() => returned([])).toThrow('the statement returned no row');
  });
});
