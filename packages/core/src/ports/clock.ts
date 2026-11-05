/**
 * The only source of the current time. Production code never calls `new Date()` or
 * `Date.now()` directly (ESLint `no-restricted-syntax`); adapters implement this port and tests
 * use `createFakeClock` from `clock.fake.ts`.
 */
export interface Clock {
  now(): Date;
}
