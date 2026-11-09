import type { ReviewerUser } from '@targus/core';

/** A GitHub user signing in; `id` is used only when the user is new. */
export interface UserLogin {
  readonly id: string;
  readonly githubId: number;
  readonly login: string;
  readonly avatarUrl: string;
  readonly now: Date;
}

/** GitHub users who signed in to the review UI. */
export interface UserRepository {
  /**
   * Insert the user, or refresh the login, avatar and last login of the one with this GitHub id
   * (keeping its id). Returns the stored user.
   */
  upsertByGithubId(user: UserLogin): Promise<ReviewerUser>;
  findById(id: string): Promise<ReviewerUser | null>;
}
