import { createAppDeps, type AppDeps, type StorageDeps } from '../composition.ts';
import { loadConfig } from '../config.ts';
import { createApprovalRepository } from '../repositories/approval.repository.ts';
import { D1BuildRepository } from '../repositories/build.repository.ts';
import { createImageRepository } from '../repositories/image.repository.ts';
import { createMembershipRepository } from '../repositories/membership.repository.ts';
import { createProjectRepository } from '../repositories/project.repository.ts';
import { createSessionRepository } from '../repositories/session.repository.ts';
import { createUserRepository } from '../repositories/user.repository.ts';
import { R2ImageStore } from '../storage/r2-image-store.ts';
import type { Bindings } from './bindings.ts';

/** The D1 repositories and the R2 image store over the Worker's bindings. */
export function createCloudflareStorage(env: Pick<Bindings, 'DB' | 'IMAGES'>): StorageDeps {
  const images = createImageRepository(env.DB);
  return {
    projects: createProjectRepository(env.DB),
    builds: new D1BuildRepository(env.DB),
    approvals: createApprovalRepository(env.DB),
    images,
    imageStore: new R2ImageStore(env.IMAGES, images),
    users: createUserRepository(env.DB),
    sessions: createSessionRepository(env.DB),
    memberships: createMembershipRepository(env.DB),
  };
}

/** Turn the Worker `env` into the app's plain dependencies; throws when the config is invalid. */
export function createWorkerDeps(env: Bindings): AppDeps {
  return createAppDeps(loadConfig(env), createCloudflareStorage(env));
}
