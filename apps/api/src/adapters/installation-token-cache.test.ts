import { createFakeClock } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { InstallationTokenCache, type InstallationToken } from './installation-token-cache.ts';

const hourMs = 60 * 60 * 1000;

/** A mint that counts its calls and hands out `token-1`, `token-2`, ... valid for an hour. */
function countingMint(clock: { now(): Date }) {
  let calls = 0;
  const mint = (): Promise<InstallationToken> => {
    calls += 1;
    const expiresAt = new Date(clock.now().getTime() + hourMs);
    return Promise.resolve({ token: `token-${String(calls)}`, expiresAt });
  };
  return { mint, calls: () => calls };
}

describe('InstallationTokenCache', () => {
  it('keeps tokens per key and forgets one on evict', async () => {
    const clock = createFakeClock();
    const cache = new InstallationTokenCache(clock);
    const { mint, calls } = countingMint(clock);

    expect(await cache.get('a', mint)).toBe('token-1');
    expect(await cache.get('a', mint)).toBe('token-1');
    expect(await cache.get('b', mint)).toBe('token-2');
    cache.evict('a');
    expect(await cache.get('a', mint)).toBe('token-3');
    expect(calls()).toBe(3);
  });

  it('does not keep a failed mint', async () => {
    const clock = createFakeClock();
    const cache = new InstallationTokenCache(clock);
    const { mint } = countingMint(clock);

    await expect(cache.get('a', () => Promise.reject(new Error('GitHub is down')))).rejects.toThrow(
      'GitHub is down',
    );
    expect(await cache.get('a', mint)).toBe('token-1');
  });

  it('lets callers waiting on a stale token share the one replacement', async () => {
    const clock = createFakeClock();
    const cache = new InstallationTokenCache(clock);
    const { mint, calls } = countingMint(clock);
    await cache.get('a', mint);
    clock.advance(hourMs);

    const tokens = await Promise.all([cache.get('a', mint), cache.get('a', mint)]);

    expect(tokens).toEqual(['token-2', 'token-2']);
    expect(calls()).toBe(2);
  });

  it('lets a caller that waited on a failed mint mint again', async () => {
    const clock = createFakeClock();
    const cache = new InstallationTokenCache(clock);
    const { mint } = countingMint(clock);
    const failing = cache.get('a', () => Promise.reject(new Error('down')));

    const [first, second] = await Promise.allSettled([failing, cache.get('a', mint)]);

    expect(first.status).toBe('rejected');
    expect(second).toEqual({ status: 'fulfilled', value: 'token-1' });
  });
});
