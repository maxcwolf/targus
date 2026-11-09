import { and, eq, exists, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { images, orgMemberships, orgs, projectImages, projects } from '../db/schema.ts';
import type { ImageRepository, UploaderOrg } from '../ports/image-repository.ts';

/** Membership test against a JSON array bound as one parameter (D1 binds at most 100). */
function inJson(column: typeof images.hash | typeof projectImages.hash, hashes: readonly string[]) {
  return sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(hashes)}))`;
}

/**
 * Driven from orgs: per org, its projects through projects_org_id_idx and then the
 * (project_id, hash) primary key of project_images. That key cannot answer "who uploaded this
 * hash" on its own, so a query starting from project_images would scan the whole table.
 */
async function selectUploaderOrgs(
  db: ReturnType<typeof drizzle>,
  hash: string,
  userId: string,
): Promise<UploaderOrg[]> {
  const uploaded = db
    .select({ one: sql`1` })
    .from(projects)
    .innerJoin(projectImages, eq(projectImages.projectId, projects.id))
    .where(and(eq(projects.orgId, orgs.id), eq(projectImages.hash, hash)));
  const rows = await db
    .select({
      orgId: orgs.id,
      githubOrg: orgs.githubOrg,
      installationId: orgs.installationId,
      githubAccountId: orgs.githubAccountId,
      member: orgMemberships.member,
      checkedAt: orgMemberships.checkedAt,
    })
    .from(orgs)
    .leftJoin(
      orgMemberships,
      and(eq(orgMemberships.userId, userId), eq(orgMemberships.orgId, orgs.id)),
    )
    .where(exists(uploaded));
  return rows.map(({ member, checkedAt, ...org }) => ({
    ...org,
    membership: member === null || checkedAt === null ? null : { member, checkedAt },
  }));
}

/** The `project_images` half: which project sent which image. */
function uploadQueries(
  database: D1Database,
): Pick<ImageRepository, 'recordUpload' | 'notUploadedBy' | 'uploaderOrgs'> {
  const db = drizzle(database);
  return {
    async recordUpload(projectId, hash, at) {
      await db
        .insert(projectImages)
        .values({ projectId, hash, createdAt: at })
        .onConflictDoNothing({ target: [projectImages.projectId, projectImages.hash] });
    },
    async notUploadedBy(projectId, hashes) {
      if (hashes.length === 0) return [];
      const rows = await db
        .select({ hash: projectImages.hash })
        .from(projectImages)
        .where(and(eq(projectImages.projectId, projectId), inJson(projectImages.hash, hashes)));
      const uploaded = new Set(rows.map((row) => row.hash));
      return hashes.filter((hash) => !uploaded.has(hash));
    },
    uploaderOrgs: (hash, userId) => selectUploaderOrgs(db, hash, userId),
  };
}

export function createImageRepository(database: D1Database): ImageRepository {
  const db = drizzle(database);

  return {
    async missing(hashes) {
      if (hashes.length === 0) return [];
      const rows = await db
        .select({ hash: images.hash })
        .from(images)
        .where(inJson(images.hash, hashes));
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
      await db.update(images).set({ lastReferencedAt: at }).where(inJson(images.hash, hashes));
    },
    ...uploadQueries(database),
  };
}
