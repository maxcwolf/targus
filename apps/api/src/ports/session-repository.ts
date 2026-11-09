import type { ReviewerUser } from '@targus/core';

/** A session to store, keyed by the SHA-256 of its id; the raw id is never stored. */
export interface NewSession {
  readonly idHash: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

/** A session that has not expired, with its user. */
export interface ActiveSession {
  readonly expiresAt: Date;
  readonly user: ReviewerUser;
}

/** Review UI sessions, each read with its user (ADR 0015). */
export interface SessionRepository {
  create(session: NewSession): Promise<void>;
  /** The session and its user, or null when it does not exist or expired at or before `now`. */
  findActive(idHash: string, now: Date): Promise<ActiveSession | null>;
  delete(idHash: string): Promise<void>;
  /** Delete every session that expired at or before `now`; resolves to how many went. */
  deleteExpired(now: Date): Promise<number>;
}
