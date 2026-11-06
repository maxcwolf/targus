import { describe, expect, it } from 'vitest';

import { cryptoIdGenerator } from './crypto-id-generator.adapter.ts';

describe('cryptoIdGenerator', () => {
  it('returns distinct uuids', () => {
    const first = cryptoIdGenerator.next();

    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(cryptoIdGenerator.next()).not.toBe(first);
  });
});
