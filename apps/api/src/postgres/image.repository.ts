import { and, eq, exists, sql } from 'drizzle-orm';

import type { ImageRepository, UploaderOrg } from '../ports/image-repository.ts';
import { inJson, type PostgresDatabase } from './database.ts';
import { images, orgMemberships, orgs, projectImages, projects } from './schema.ts';

/**
 * Driven from orgs: per org, its projects through projects_org_id_idx and then the
 * (project_id, hash) primary key of project_images, as the D1 adapter does.
 */
async function selectUploaderOrgs(
  db: PostgresDatabase,
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
  db: PostgresDatabase,
): Pick<ImageRepository, 'recordUpload' | 'notUploadedBy' | 'uploaderOrgs'> {
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

/** Postgres adapter for `images` and `project_images` (ADR 0014). */
export function createPostgresImageRepository(db: PostgresDatabase): ImageRepository {
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
    ...uploadQueries(db),
  };
}
