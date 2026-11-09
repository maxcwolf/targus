import type { StorageDeps } from '../composition.ts';
import { createPostgresApprovalRepository } from './approval.repository.ts';
import { PostgresBuildRepository } from './build.repository.ts';
import type { PostgresDatabase } from './database.ts';
import { createPostgresImageRepository } from './image.repository.ts';
import { createPostgresMembershipRepository } from './membership.repository.ts';
import { createPostgresProjectRepository } from './project.repository.ts';
import { createPostgresSessionRepository } from './session.repository.ts';
import { createPostgresUserRepository } from './user.repository.ts';

/** Every repository a host needs, over one Postgres client; the host adds its image store. */
export type PostgresRepositories = Omit<StorageDeps, 'imageStore'>;

/** The Postgres repositories over `db`, whose schema the host has already migrated. */
export function createPostgresRepositories(db: PostgresDatabase): PostgresRepositories {
  return {
    projects: createPostgresProjectRepository(db),
    builds: new PostgresBuildRepository(db),
    approvals: createPostgresApprovalRepository(db),
    images: createPostgresImageRepository(db),
    users: createPostgresUserRepository(db),
    sessions: createPostgresSessionRepository(db),
    memberships: createPostgresMembershipRepository(db),
  };
}
