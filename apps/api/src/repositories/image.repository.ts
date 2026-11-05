import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { images } from '../db/schema.js';

/** What the API knows about one stored PNG. */
export interface ImageRecord {
  readonly hash: string;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The `images` metadata table. R2 holds the bytes; this table answers "which hashes are
 * missing" with one indexed query instead of an R2 listing (plan.md section 9).
 */
export interface ImageRepository {
  /** The subset of `hashes` with no row, in input order. */
  missing(hashes: readonly string[]): Promise<string[]>;
  /** Insert the row, or leave an existing one as is. */
  record(image: ImageRecord, at: Date): Promise<void>;
  /** Bump `last_referenced_at` of the rows that exist (for the v1.1 retention job). */
  touch(hashes: readonly string[], at: Date): Promise<void>;
}

/** Membership test against a JSON array bound as one parameter (D1 binds at most 100). */
function hashIn(hashes: readonly string[]) {
  return sql`${images.hash} IN (SELECT value FROM json_each(${JSON.stringify(hashes)}))`;
}

export function createImageRepository(database: D1Database): ImageRepository {
  const db = drizzle(database);

  return {
    async missing(hashes) {
      if (hashes.length === 0) return [];
      const rows = await db.select({ hash: images.hash }).from(images).where(hashIn(hashes));
      const present = new Set(rows.map((row) => row.hash));
      return hashes.filter((hash) => !present.has(hash));
    },
    async record(image, at) {
      await db
        .insert(images)
        .values({ ...image, createdAt: at, lastReferencedAt: at })
        .onConflictDoNothing({ target: images.hash });
    },
    async touch(hashes, at) {
      if (hashes.length === 0) return;
      await db.update(images).set({ lastReferencedAt: at }).where(hashIn(hashes));
    },
  };
}
