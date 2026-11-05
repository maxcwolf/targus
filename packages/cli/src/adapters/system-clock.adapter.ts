import type { Clock } from '@targus/core';

/** The real `Clock`: wall time from the host. */
export const systemClock: Clock = { now: () => new Date() };
