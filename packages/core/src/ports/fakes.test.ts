import { describe, expect, it } from 'vitest';

import { createFakeClock, fakeClockEpoch } from './clock.fake.ts';
import { createFakeIdGenerator } from './id-generator.fake.ts';

describe('createFakeClock', () => {
  it('starts at the epoch and only moves when told to', () => {
    const clock = createFakeClock();

    expect(clock.now().toISOString()).toBe(fakeClockEpoch);
    clock.advance(1500);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:01.500Z');
    clock.set('2026-11-04T12:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-11-04T12:00:00.000Z');
  });

  it('returns a fresh Date each call so callers cannot mutate its time', () => {
    const clock = createFakeClock(new Date('2026-05-05T00:00:00.000Z'));
    clock.now().setFullYear(1999);

    expect(clock.now().getUTCFullYear()).toBe(2026);
  });
});

describe('createFakeIdGenerator', () => {
  it('yields sequential ids with the given prefix', () => {
    const ids = createFakeIdGenerator('build');

    expect([ids.next(), ids.next(), ids.next()]).toEqual(['build-1', 'build-2', 'build-3']);
  });

  it('defaults the prefix to "id"', () => {
    expect(createFakeIdGenerator().next()).toBe('id-1');
  });
});
