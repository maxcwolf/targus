import { describe, expect, it } from 'vitest';

import { retryDelayMs, withRetry } from './retry.js';

const policy = { attempts: 3, initialDelayMs: 100 };

function failing(times: number) {
  let calls = 0;
  return {
    call: (attempt: number) => {
      calls += 1;
      return calls <= times
        ? Promise.reject(new Error(`try ${attempt}`))
        : Promise.resolve(attempt);
    },
    calls: () => calls,
  };
}

describe('withRetry', () => {
  it('waits with exponential backoff until a try succeeds', async () => {
    const waits: number[] = [];
    const flaky = failing(2);

    const result = await withRetry(flaky.call, policy, {
      sleep: (ms) => Promise.resolve(void waits.push(ms)),
      isRetryable: () => true,
    });

    expect(result).toBe(3);
    expect(waits).toEqual([100, 200]);
  });

  it('throws the last error, or what onGiveUp makes of it, after the last try', async () => {
    const hooks = { sleep: () => Promise.resolve(), isRetryable: () => true };

    await expect(withRetry(failing(5).call, policy, hooks)).rejects.toThrow('try 3');
    await expect(
      withRetry(failing(5).call, policy, {
        ...hooks,
        onGiveUp: (_error, attempts) => new Error(`gave up after ${attempts}`),
      }),
    ).rejects.toThrow('gave up after 3');
  });

  it('stops at once on an error that is not retryable, and always tries once', async () => {
    const once = failing(5);

    await expect(
      withRetry(
        once.call,
        { attempts: 0, initialDelayMs: 1 },
        {
          sleep: () => Promise.resolve(),
          isRetryable: () => false,
        },
      ),
    ).rejects.toThrow('try 1');
    expect(once.calls()).toBe(1);
  });
});

describe('retryDelayMs', () => {
  it('doubles from the initial delay', () => {
    expect([1, 2, 3].map((attempt) => retryDelayMs(policy, attempt))).toEqual([100, 200, 400]);
  });
});
