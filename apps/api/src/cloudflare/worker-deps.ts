import { createAppDeps, type AppDeps, type StorageDeps } from '../composition.ts';
import { loadConfig, type ApiConfig } from '../config.ts';
import { createApprovalRepository } from '../repositories/approval.repository.ts';
import { D1BuildRepository } from '../repositories/build.repository.ts';
import { createImageRepository } from '../repositories/image.repository.ts';
import { createMembershipRepository } from '../repositories/membership.repository.ts';
import { createProjectRepository } from '../repositories/project.repository.ts';
import { createSessionRepository } from '../repositories/session.repository.ts';
import { createUserRepository } from '../repositories/user.repository.ts';
import { R2ImageStore } from '../storage/r2-image-store.ts';
import { S3ImageStore } from '../storage/s3-image-store.ts';
import type { Bindings } from './bindings.ts';

/** The image store `config` names (ADR 0041): its S3 bucket when set, else the R2 binding. */
function imageStoreFor(
  config: Pick<ApiConfig, 's3'>,
  bucket: R2Bucket,
  images: ReturnType<typeof createImageRepository>,
): StorageDeps['imageStore'] {
  if (config.s3 === null) return new R2ImageStore(bucket, images);
  return new S3ImageStore(config.s3, images, (request) => fetch(request));
}

/** The D1 repositories and the image store (R2, or S3 when configured) over the bindings. */
export function createCloudflareStorage(
  env: Pick<Bindings, 'DB' | 'IMAGES'>,
  config: Pick<ApiConfig, 's3'>,
): StorageDeps {
  const images = createImageRepository(env.DB);
  return {
    projects: createProjectRepository(env.DB),
    builds: new D1BuildRepository(env.DB),
    approvals: createApprovalRepository(env.DB),
    images,
    imageStore: imageStoreFor(config, env.IMAGES, images),
    users: createUserRepository(env.DB),
    sessions: createSessionRepository(env.DB),
    memberships: createMembershipRepository(env.DB),
  };
}

/** Turn the Worker `env` into the app's plain dependencies; throws when the config is invalid. */
export function createWorkerDeps(env: Bindings): AppDeps {
  const config = loadConfig(env);
  return createAppDeps(config, createCloudflareStorage(env, config));
}
