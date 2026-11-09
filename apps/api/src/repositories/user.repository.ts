import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { users } from '../db/schema.ts';
import type { UserRepository } from '../ports/user-repository.ts';

const reviewerColumns = {
  id: users.id,
  githubId: users.githubId,
  login: users.login,
  avatarUrl: users.avatarUrl,
};

/** D1 adapter for `users`. */
export function createUserRepository(database: D1Database): UserRepository {
  const db = drizzle(database);

  return {
    upsertByGithubId({ id, githubId, login, avatarUrl, now }) {
      return db
        .insert(users)
        .values({ id, githubId, login, avatarUrl, createdAt: now, lastLoginAt: now })
        .onConflictDoUpdate({
          target: users.githubId,
          set: { login, avatarUrl, lastLoginAt: now },
        })
        .returning(reviewerColumns)
        .get();
    },
    async findById(id) {
      const row = await db.select(reviewerColumns).from(users).where(eq(users.id, id)).get();
      return row ?? null;
    },
  };
}
