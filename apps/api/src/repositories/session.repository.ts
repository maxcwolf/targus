import { and, eq, gt, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { sessions, users } from '../db/schema.ts';
import type { SessionRepository } from '../ports/session-repository.ts';

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
