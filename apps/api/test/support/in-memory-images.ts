import type { ImageStore, StoryResult } from '@targus/core';

import type { ImageRecord, ImageRepository } from '../../src/repositories/image.repository.js';

export interface InMemoryImages extends ImageRepository, ImageStore {
  readonly records: Map<string, ImageRecord & { lastReferencedAt: Date }>;
  readonly bytes: Map<string, Uint8Array>;
  /** What `projectIdsReferencing` answers, by hash. */
  readonly references: Map<string, string[]>;
  /** The hashes each project uploaded, by project id. */
  readonly uploads: Map<string, Set<string>>;
}

/** The image metadata table and the R2 store in one, kept in step like the real pair. */
export function createInMemoryImages(): InMemoryImages {
  const records = new Map<string, ImageRecord & { lastReferencedAt: Date }>();
  const bytes = new Map<string, Uint8Array>();
  const references = new Map<string, string[]>();
  const uploads = new Map<string, Set<string>>();
  return {
    records,
    bytes,
    missing: (hashes) => Promise.resolve(hashes.filter((hash) => !records.has(hash))),
    record(image, at) {
      if (!records.has(image.hash)) records.set(image.hash, { ...image, lastReferencedAt: at });
      return Promise.resolve();
    },
    touch(hashes, at) {
      for (const hash of hashes) {
        const record = records.get(hash);
        if (record !== undefined) records.set(hash, { ...record, lastReferencedAt: at });
      }
      return Promise.resolve();
    },
    put(hash, value) {
      if (!bytes.has(hash)) bytes.set(hash, value);
      return Promise.resolve();
    },
    get: (hash) => Promise.resolve(bytes.get(hash) ?? null),
    // The real one joins snapshots; service tests set the answer per hash.
    projectIdsReferencing: (hash) => Promise.resolve(references.get(hash) ?? []),
    references,
    recordUpload(projectId, hash) {
      uploads.set(projectId, (uploads.get(projectId) ?? new Set()).add(hash));
      return Promise.resolve();
    },
    notUploadedBy: (projectId, hashes) =>
      Promise.resolve(hashes.filter((hash) => uploads.get(projectId)?.has(hash) !== true)),
    uploads,
  };
}

/** The capture and diff hashes that `results` name, each once. */
export function hashesOf(results: readonly StoryResult[]): string[] {
  const named = results.flatMap((result) => [result.imageHash, result.diffHash]);
  return [...new Set(named.filter((hash) => hash !== null))];
}

/**
 * Mark every image `results` name as uploaded by the project, for tests that submit results
 * with made-up hashes and are not about the upload itself.
 */
export async function markUploaded(
  images: Pick<ImageRepository, 'recordUpload'>,
  projectId: string,
  results: readonly StoryResult[],
  at: Date = new Date(0),
): Promise<void> {
  for (const hash of hashesOf(results)) await images.recordUpload(projectId, hash, at);
}
