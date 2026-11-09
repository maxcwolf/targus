import { eq } from 'drizzle-orm';

import type { UserRepository } from '../ports/user-repository.ts';
import { returned, type PostgresDatabase } from './database.ts';
import { users } from './schema.ts';

const reviewerColumns = {
  id: users.id,
  githubId: users.githubId,
  login: users.login,
  avatarUrl: users.avatarUrl,
};

/** Postgres adapter for `users`. */
export function createPostgresUserRepository(db: PostgresDatabase): UserRepository {
  return {
    async upsertByGithubId({ id, githubId, login, avatarUrl, now }) {
      const rows = await db
        .insert(users)
        .values({ id, githubId, login, avatarUrl, createdAt: now, lastLoginAt: now })
        .onConflictDoUpdate({
          target: users.githubId,
          set: { login, avatarUrl, lastLoginAt: now },
        })
        .returning(reviewerColumns);
      return returned(rows);
    },
    async findById(id) {
      const [row] = await db.select(reviewerColumns).from(users).where(eq(users.id, id));
      return row ?? null;
    },
  };
}
