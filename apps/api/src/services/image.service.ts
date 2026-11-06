import { ImageHash, TargusError, type UploadImageResponse } from '@targus/core';

import { sha256Hex } from '../lib/sha256.js';
import { canAccessOrg } from './access.service.js';
import type { Project } from '../repositories/project.repository.js';
import type { ServiceDeps } from './deps.js';
import type { Principal, Reviewer } from './principal.js';
import { readPngDimensions } from './png.js';

type ImageDeps = Pick<ServiceDeps, 'clock' | 'images' | 'imageStore'>;

function parseHash(hash: string): string {
  const parsed = ImageHash.safeParse(hash);
  if (!parsed.success)
    throw new TargusError('bad_request', 'expected a lowercase sha256 hex digest');
  return parsed.data;
}

/**
 * `PUT /api/images/:hash`: store a PNG under its SHA-256. The body must be a PNG whose digest is
 * the path hash. Idempotent: an image that is already stored is only touched. Either way the
 * project has now sent the bytes itself, which is what lets it read the image back and name it
 * in its results.
 */
export async function uploadImage(
  deps: ImageDeps,
  project: Project,
  hash: string,
  bytes: Uint8Array,
): Promise<UploadImageResponse> {
  const expected = parseHash(hash);
  const { width, height } = readPngDimensions(bytes);
  if ((await sha256Hex(bytes)) !== expected) {
    throw new TargusError('bad_request', 'body sha256 does not match the path hash');
  }
  const now = deps.clock.now();
  const [missing] = await deps.imageStore.missing([expected]);
  if (missing === undefined) {
    await deps.images.touch([expected], now);
  } else {
    await deps.imageStore.put(expected, bytes);
    await deps.images.record({ hash: expected, sizeBytes: bytes.length, width, height }, now);
  }
  await deps.images.recordUpload(project.id, expected, now);
  return { hash: expected, stored: missing !== undefined };
}

type ReadImageDeps = Pick<
  ServiceDeps,
  'clock' | 'github' | 'images' | 'imageStore' | 'memberships'
>;

/**
 * Whether a project of an org the reviewer belongs to uploaded the image. One query finds every
 * such org with the reviewer's cached membership. Orgs with a cached answer go first, so GitHub
 * is usually asked only when the cache grants nothing.
 */
async function reviewerMayRead(
  deps: ReadImageDeps,
  reviewer: Reviewer,
  hash: string,
): Promise<boolean> {
  const uploaders = await deps.images.uploaderOrgs(hash, reviewer.user.id);
  const cachedFirst = [...uploaders].sort(
    (a, b) => Number(a.membership === null) - Number(b.membership === null),
  );
  for (const org of cachedFirst) {
    if (await canAccessOrg(deps, reviewer, org, () => Promise.resolve(org.membership))) {
      return true;
    }
  }
  return false;
}

/** Whether the project sent the bytes of the image itself. */
async function projectMayRead(
  deps: ReadImageDeps,
  project: Project,
  hash: string,
): Promise<boolean> {
  return (await deps.images.notUploadedBy(project.id, [hash])).length === 0;
}

/**
 * `GET /api/images/:hash`: the PNG bytes, or `not_found`. The CLI reads with its project token
 * (baselines) and gets only images that project uploaded; a reviewer only images a project of
 * one of their orgs uploaded. An image the caller may not read answers `not_found` exactly like a missing one,
 * so neither a token nor a session learns that a hash exists in another tenant.
 */
export async function getImage(
  deps: ReadImageDeps,
  principal: Principal,
  hash: string,
): Promise<Uint8Array> {
  const expected = parseHash(hash);
  const allowed =
    principal.kind === 'project'
      ? await projectMayRead(deps, principal.project, expected)
      : await reviewerMayRead(deps, principal.reviewer, expected);
  const bytes = allowed ? await deps.imageStore.get(expected) : null;
  if (bytes === null) throw new TargusError('not_found', `no image ${hash}`);
  return bytes;
}
