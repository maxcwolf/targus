/**
 * Content-addressed PNG storage keyed by SHA-256 hex (plan.md section 5.1). The API adapter is
 * `R2ImageStore`; the CLI reaches it through the API rather than directly.
 */
export interface ImageStore {
  /** Return the subset of `hashes` that are not stored yet, in input order. */
  missing(hashes: readonly string[]): Promise<string[]>;
  /** Store `bytes` under `hash`. Idempotent: storing an existing hash is a no-op. */
  put(hash: string, bytes: Uint8Array): Promise<void>;
  /** Read the image stored under `hash`, or `null` when there is none. */
  get(hash: string): Promise<Uint8Array | null>;
}
