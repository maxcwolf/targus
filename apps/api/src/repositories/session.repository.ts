import type { ReviewerUser } from '@targus/core';
import { and, eq, gt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { sessions, users } from '../db/schema.js';

export interface NewSession {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

/** A session that has not expired, with its user. */
export interface ActiveSession {
  readonly sessionId: string;
  readonly expiresAt: Date;
  readonly user: ReviewerUser;
}

export interface SessionRepository {
  create(session: NewSession): Promise<void>;
  /** The session and its user, or null when it does not exist or expired at or before `now`. */
  findActive(id: string, now: Date): Promise<ActiveSession | null>;
  delete(id: string): Promise<void>;
}

/** D1 adapter for `sessions`, joined with `users`. */
export function createSessionRepository(database: D1Database): SessionRepository {
  const db = drizzle(database);

  return {
    async create(session) {
      await db.insert(sessions).values(session);
    },
    async findActive(id, now) {
      const row = await db
        .select({
          sessionId: sessions.id,
          expiresAt: sessions.expiresAt,
          id: users.id,
          githubId: users.githubId,
          login: users.login,
          avatarUrl: users.avatarUrl,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
        .get();
      if (row === undefined) return null;
      const { sessionId, expiresAt, ...user } = row;
      return { sessionId, expiresAt, user };
    },
    async delete(id) {
      await db.delete(sessions).where(eq(sessions.id, id));
    },
  };
}
