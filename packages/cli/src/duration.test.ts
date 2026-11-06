import { describe, expect, it } from 'vitest';

import { formatDuration } from './duration.ts';

describe('formatDuration', () => {
  it.each([
    [20, '20ms'],
    [1000, '1s'],
    [1500, '1.5s'],
    [45_000, '45s'],
    [60_000, '1m'],
    [90_000, '90s'],
    [300_000, '5m'],
  ])('%i -> %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});
