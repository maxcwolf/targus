import { describe, expect, it } from 'vitest';

import { cryptoIdGenerator } from './crypto-id.adapter.js';
import { systemClock } from './system-clock.adapter.js';

describe('systemClock', () => {
  it('returns the current time', () => {
    expect(systemClock.now()).toBeInstanceOf(Date);
  });
});

describe('cryptoIdGenerator', () => {
  it('returns distinct uuids', () => {
    const first = cryptoIdGenerator.next();

    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(cryptoIdGenerator.next()).not.toBe(first);
  });
});
