import type { DeviceDriver } from '@targus/core';

/** What settling a selected story needs: `CaptureStoriesInput` has all of it. */
export interface SettleInput {
  readonly driver: Pick<DeviceDriver, 'screenshot'>;
  readonly options: { readonly stabilityGapMs: number; readonly maxAttempts: number };
  readonly sleep: (ms: number) => Promise<void>;
  readonly hash: (bytes: Uint8Array) => string;
  readonly compareImages: (a: Uint8Array, b: Uint8Array) => { readonly ratio: number };
}

interface Settled {
  readonly png: Uint8Array;
  readonly attempts: number;
  readonly stable: boolean;
}

/**
 * Wait `firstSettleMs`, then take two screenshots `stabilityGapMs` apart and keep the first if
 * they match; otherwise retry with a doubled wait, up to `maxAttempts`, and report it unstable.
 */
export async function settle(input: SettleInput, firstSettleMs: number): Promise<Settled> {
  const { driver, options, sleep } = input;
  let settleMs = firstSettleMs;
  let last: Settled | undefined;
  for (let attempt = 1; attempt <= Math.max(1, options.maxAttempts); attempt += 1) {
    await sleep(settleMs);
    const first = await driver.screenshot();
    await sleep(options.stabilityGapMs);
    const second = await driver.screenshot();
    last = { png: first, attempts: attempt, stable: isSame(input, first, second) };
    if (last.stable) return last;
    settleMs *= 2;
  }
  if (last === undefined) throw new Error('no capture attempt ran');
  return last;
}

/** Equal bytes are equal images; only differing bytes pay for a pixel comparison. */
function isSame(input: SettleInput, first: Uint8Array, second: Uint8Array): boolean {
  if (input.hash(first) === input.hash(second)) return true;
  return input.compareImages(first, second).ratio === 0;
}
