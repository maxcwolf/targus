import type { ReviewerUser } from '@targus/core';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { users } from '../db/schema.ts';

/** A GitHub user signing in; `id` is used only when the user is new. */
export interface UserLogin {
  readonly id: string;
  readonly githubId: number;
  readonly login: string;
  readonly avatarUrl: string;
  readonly now: Date;
}

export interface UserRepository {
  /**
   * Insert the user, or refresh the login, avatar and last login of the one with this GitHub id
   * (keeping its id). Returns the stored user.
   */
  upsertByGithubId(user: UserLogin): Promise<ReviewerUser>;
  findById(id: string): Promise<ReviewerUser | null>;
}

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
