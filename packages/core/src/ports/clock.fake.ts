import type { Clock } from './clock.js';

/** A `Clock` that only moves when told to. */
export interface FakeClock extends Clock {
  /** Move time forward by `ms` milliseconds. */
  advance(ms: number): void;
  /** Jump to an exact instant. */
  set(instant: Date | string): void;
}

export const fakeClockEpoch = '2026-01-01T00:00:00.000Z';

export function createFakeClock(start: Date | string = fakeClockEpoch): FakeClock {
  let current = new Date(start).getTime();

  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms;
    },
    set: (instant) => {
      current = new Date(instant).getTime();
    },
  };
}
