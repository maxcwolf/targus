import type { ReviewerUser } from '@targus/core';
import { and, eq, gt, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { sessions, users } from '../db/schema.js';

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

export interface SessionRepository {
  create(session: NewSession): Promise<void>;
  /** The session and its user, or null when it does not exist or expired at or before `now`. */
  findActive(idHash: string, now: Date): Promise<ActiveSession | null>;
  delete(idHash: string): Promise<void>;
  /** Delete every session that expired at or before `now`; resolves to how many went. */
  deleteExpired(now: Date): Promise<number>;
}

/** D1 adapter for `sessions`, joined with `users`. */
export function createSessionRepository(database: D1Database): SessionRepository {
  const db = drizzle(database);

  return {
    async create(session) {
      await db.insert(sessions).values(session);
    },
    async findActive(idHash, now) {
      const row = await db
        .select({
          expiresAt: sessions.expiresAt,
          id: users.id,
          githubId: users.githubId,
          login: users.login,
          avatarUrl: users.avatarUrl,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.idHash, idHash), gt(sessions.expiresAt, now)))
        .get();
      if (row === undefined) return null;
      const { expiresAt, ...user } = row;
      return { expiresAt, user };
    },
    async delete(idHash) {
      await db.delete(sessions).where(eq(sessions.idHash, idHash));
    },
    async deleteExpired(now) {
      const result = await db.delete(sessions).where(lte(sessions.expiresAt, now)).run();
      return result.meta.changes;
    },
  };
}
