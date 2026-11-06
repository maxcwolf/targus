import type { ReviewerUser } from '@targus/core';

import type { Project } from '../repositories/project.repository.ts';

/** A signed-in user of the review UI. */
export interface Reviewer {
  /** The raw id from the cookie; D1 holds only its SHA-256. */
  readonly sessionId: string;
  readonly user: ReviewerUser;
}

/** Who is reading: the CLI with a project token, or a reviewer with a session cookie. */
export type Principal =
  | { readonly kind: 'project'; readonly project: Project }
  | { readonly kind: 'reviewer'; readonly reviewer: Reviewer };
