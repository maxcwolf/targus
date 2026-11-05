import type { Clock } from '@targus/core';

/** `Clock` backed by the Worker's clock. */
export const systemClock: Clock = { now: () => new Date() };
