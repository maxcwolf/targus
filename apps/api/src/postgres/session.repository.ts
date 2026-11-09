import { and, eq, gt, lte } from 'drizzle-orm';

import type { SessionRepository } from '../ports/session-repository.ts';
import type { PostgresDatabase } from './database.ts';
import { sessions, users } from './schema.ts';

/** Postgres adapter for `sessions`, joined with `users`. */
export function createPostgresSessionRepository(db: PostgresDatabase): SessionRepository {
  return {
    async create(session) {
      await db.insert(sessions).values(session);
    },
    async findActive(idHash, now) {
      const [row] = await db
        .select({
          expiresAt: sessions.expiresAt,
          id: users.id,
          githubId: users.githubId,
          login: users.login,
          avatarUrl: users.avatarUrl,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.idHash, idHash), gt(sessions.expiresAt, now)));
      if (row === undefined) return null;
      const { expiresAt, ...user } = row;
      return { expiresAt, user };
    },
    async delete(idHash) {
      await db.delete(sessions).where(eq(sessions.idHash, idHash));
    },
    async deleteExpired(now) {
      // Counted from the rows returned: how a driver reports "rows affected" differs by driver.
      const gone = await db
        .delete(sessions)
        .where(lte(sessions.expiresAt, now))
        .returning({ idHash: sessions.idHash });
      return gone.length;
    },
  };
}
