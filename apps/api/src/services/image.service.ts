import { ImageHash, TargusError, type UploadImageResponse } from '@targus/core';

import { sha256Hex } from '../lib/sha256.js';
import { canAccessProject } from './access.service.js';
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
 * the path hash. Idempotent: an image that is already stored is only touched.
 */
export async function uploadImage(
  deps: ImageDeps,
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
    return { hash: expected, stored: false };
  }
  await deps.imageStore.put(expected, bytes);
  await deps.images.record({ hash: expected, sizeBytes: bytes.length, width, height }, now);
  return { hash: expected, stored: true };
}

type ReadImageDeps = Pick<
  ServiceDeps,
  'clock' | 'github' | 'images' | 'imageStore' | 'memberships' | 'projects'
>;

/** Whether some project that references the image is one the reviewer may read. */
async function reviewerMayRead(
  deps: ReadImageDeps,
  reviewer: Reviewer,
  hash: string,
): Promise<boolean> {
  for (const projectId of await deps.images.projectIdsReferencing(hash)) {
    const project = await deps.projects.findById(projectId);
    if (project !== null && (await canAccessProject(deps, reviewer, project))) return true;
  }
  return false;
}

/**
 * `GET /api/images/:hash`: the PNG bytes, or `not_found`. The CLI reads with its project token
 * (baselines); a reviewer only images of builds in their orgs, and an image they may not read
 * answers `not_found` exactly like a missing one, so its existence never leaks.
 */
export async function getImage(
  deps: ReadImageDeps,
  principal: Principal,
  hash: string,
): Promise<Uint8Array> {
  const expected = parseHash(hash);
  const allowed =
    principal.kind === 'project' || (await reviewerMayRead(deps, principal.reviewer, expected));
  const bytes = allowed ? await deps.imageStore.get(expected) : null;
  if (bytes === null) throw new TargusError('not_found', `no image ${hash}`);
  return bytes;
}
