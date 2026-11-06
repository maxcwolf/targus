export interface RetryPolicy {
  /** Tries in all, the first one included. */
  readonly attempts: number;
  /** Wait before the second try; doubled before each later one. */
  readonly initialDelayMs: number;
}

/** Four tries, 0.5s, 1s and 2s apart: rides out a deploy or a blip, gives up within seconds. */
export const defaultRetryPolicy: RetryPolicy = { attempts: 4, initialDelayMs: 500 };

export interface RetryHooks {
  /** Waits between tries; injected so tests do not really wait. */
  readonly sleep: (ms: number) => Promise<void>;
  readonly isRetryable: (error: unknown) => boolean;
  /** Called before each wait with the error, the try that comes next and the wait. */
  readonly onRetry?: (error: unknown, nextAttempt: number, delayMs: number) => void;
  /** What to throw when the last try failed with a retryable error. Defaults to that error. */
  readonly onGiveUp?: (error: unknown, attempts: number) => unknown;
}

/** The wait before try `attempt + 1`: exponential backoff from `initialDelayMs`. */
export function retryDelayMs(policy: RetryPolicy, attempt: number): number {
  return policy.initialDelayMs * 2 ** (attempt - 1);
}

/**
 * Run `call` until it succeeds, fails with an error `isRetryable` rejects, or `policy.attempts`
 * tries have failed. `call` gets the 1-based number of the try.
 */
export async function withRetry<T>(
  call: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  hooks: RetryHooks,
): Promise<T> {
  const attempts = Math.max(1, policy.attempts);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call(attempt);
    } catch (error) {
      if (!hooks.isRetryable(error)) throw error;
      if (attempt >= attempts) throw hooks.onGiveUp ? hooks.onGiveUp(error, attempts) : error;
      const delayMs = retryDelayMs(policy, attempt);
      hooks.onRetry?.(error, attempt + 1, delayMs);
      await hooks.sleep(delayMs);
    }
  }
}
