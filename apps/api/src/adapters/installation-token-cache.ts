import type { Clock } from '@targus/core';

/** A GitHub App installation access token and when GitHub says it stops working. */
export interface InstallationToken {
  readonly token: string;
  readonly expiresAt: Date;
}

/** How long before its expiry a cached token is no longer handed out. */
export const tokenSafetyMarginMs = 5 * 60 * 1000;

/**
 * Installation tokens kept in memory for the life of the isolate. GitHub's tokens last an hour,
 * so each installation is minted about once an hour instead of on every call. A token is reused
 * until `tokenSafetyMarginMs` before its expiry, measured with the `Clock`; callers asking at the
 * same time share one mint, and a failed mint is not kept. Nothing is persisted: a new isolate
 * mints again, which costs one GitHub call.
 */
export class InstallationTokenCache {
  private readonly entries = new Map<string, Promise<InstallationToken>>();

  constructor(private readonly clock: Clock) {}

  /** A token for `key` that is good for at least the safety margin, minting one when needed. */
  async get(key: string, mint: () => Promise<InstallationToken>): Promise<string> {
    const entry = this.entries.get(key);
    if (entry === undefined) return this.mintInto(key, mint);
    const cached = await entry.catch(() => null);
    if (cached !== null && this.isFresh(cached)) return cached.token;
    // Stale or failed. Another caller may have started the replacement while this one waited.
    const current = this.entries.get(key);
    if (current !== undefined && current !== entry) return this.get(key, mint);
    return this.mintInto(key, mint);
  }

  /** Forget the token for `key`, for example after GitHub rejected it. */
  evict(key: string): void {
    this.entries.delete(key);
  }

  /** Mint and store the promise before awaiting it, so concurrent callers share the mint. */
  private async mintInto(key: string, mint: () => Promise<InstallationToken>): Promise<string> {
    const minting = mint();
    this.entries.set(key, minting);
    try {
      return (await minting).token;
    } catch (error) {
      if (this.entries.get(key) === minting) this.entries.delete(key);
      throw error;
    }
  }

  private isFresh(token: InstallationToken): boolean {
    return token.expiresAt.getTime() - tokenSafetyMarginMs > this.clock.now().getTime();
  }
}
