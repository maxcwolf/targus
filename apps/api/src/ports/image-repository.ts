import type { CachedMembership } from './membership-repository.ts';

/** What the API knows about one stored PNG. */
export interface ImageRecord {
  readonly hash: string;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
}

/** An org with a project that uploaded an image, and one user's cached membership of it. */
export interface UploaderOrg {
  readonly orgId: string;
  readonly githubOrg: string;
  readonly installationId: number | null;
  /** The installation's account id (ADR 0024); null until read from GitHub. */
  readonly githubAccountId: number | null;
  /** The user's row in the one-hour membership cache, fresh or not; null when there is none. */
  readonly membership: CachedMembership | null;
}

/**
 * The `images` metadata table. The image store holds the bytes; this table answers "which hashes are
 * missing" with one indexed query instead of a bucket listing (plan.md section 9).
 */
export interface ImageRepository {
  /** The subset of `hashes` with no row, in input order. */
  missing(hashes: readonly string[]): Promise<string[]>;
  /** Insert the row, or leave an existing one as is. */
  record(image: ImageRecord, at: Date): Promise<void>;
  /** Bump `last_referenced_at` of the rows that exist (for the v1.1 retention job). */
  touch(hashes: readonly string[], at: Date): Promise<void>;
  /** Remember that `projectId` sent the bytes of `hash` itself. Idempotent. */
  recordUpload(projectId: string, hash: string, at: Date): Promise<void>;
  /**
   * The subset of `hashes` whose bytes `projectId` has never sent, in input order. Images are
   * shared between tenants, so this, not `missing`, decides what a project may read or name.
   */
  notUploadedBy(projectId: string, hashes: readonly string[]): Promise<string[]>;
  /**
   * Every org with a project that uploaded `hash`, each with `userId`'s cached membership, in
   * one query: what authorizes a reviewer's read of an image.
   */
  uploaderOrgs(hash: string, userId: string): Promise<UploaderOrg[]>;
}
