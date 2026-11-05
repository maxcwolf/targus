import { eq, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { orgs, projects } from '../db/schema.js';

/** A project with the org fields the API needs (GitHub App installation for check runs). */
export interface Project {
  readonly id: string;
  readonly orgId: string;
  readonly repo: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly createdAt: Date;
  readonly org: { readonly githubOrg: string; readonly installationId: number | null };
}

/** What `ProjectRepository.create` needs; ids and timestamps come from the ports. */
export interface NewProject {
  readonly id: string;
  /** Used only when the org row does not exist yet. */
  readonly newOrgId: string;
  readonly githubOrg: string;
  readonly installationId: number | null;
  readonly repo: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly tokenHash: string;
  readonly createdAt: Date;
}

export interface ProjectRepository {
  /**
   * Insert the project, creating its org when `githubOrg` is new. A non-null `installationId`
   * replaces the org's stored one, so re-running with the installation set fills it in.
   */
  create(project: NewProject): Promise<Project>;
  findById(id: string): Promise<Project | null>;
  findByRepo(repo: string): Promise<Project | null>;
  findByTokenHash(tokenHash: string): Promise<Project | null>;
}

type Row = Omit<typeof projects.$inferSelect, 'tokenHash'> & {
  githubOrg: string;
  installationId: number | null;
};

function toProject(row: Row): Project {
  const { githubOrg, installationId, ...project } = row;
  return { ...project, org: { githubOrg, installationId } };
}

type Db = ReturnType<typeof drizzle>;

async function findOne(db: Db, where: SQL): Promise<Project | null> {
  const row = await db
    .select({
      id: projects.id,
      orgId: projects.orgId,
      repo: projects.repo,
      name: projects.name,
      defaultBranch: projects.defaultBranch,
      createdAt: projects.createdAt,
      githubOrg: orgs.githubOrg,
      installationId: orgs.installationId,
    })
    .from(projects)
    .innerJoin(orgs, eq(orgs.id, projects.orgId))
    .where(where)
    .get();
  return row === undefined ? null : toProject(row);
}

function upsertOrg(
  db: Db,
  project: NewProject,
): Promise<{ id: string; installationId: number | null }> {
  return db
    .insert(orgs)
    .values({
      id: project.newOrgId,
      githubOrg: project.githubOrg,
      installationId: project.installationId,
      createdAt: project.createdAt,
    })
    .onConflictDoUpdate({
      target: orgs.githubOrg,
      // A no-op update when there is no installation id, so `returning` still yields the row.
      set:
        project.installationId === null
          ? { githubOrg: project.githubOrg }
          : { installationId: project.installationId },
    })
    .returning({ id: orgs.id, installationId: orgs.installationId })
    .get();
}

/** D1 adapter for `projects`, joined with `orgs` (ADR 0007: every project hangs off an org). */
export function createProjectRepository(database: D1Database): ProjectRepository {
  const db = drizzle(database);

  return {
    async create(project) {
      const org = await upsertOrg(db, project);
      const row = {
        id: project.id,
        orgId: org.id,
        repo: project.repo,
        name: project.name,
        defaultBranch: project.defaultBranch,
        createdAt: project.createdAt,
      };
      await db.insert(projects).values({ ...row, tokenHash: project.tokenHash });
      return toProject({
        ...row,
        githubOrg: project.githubOrg,
        installationId: org.installationId,
      });
    },
    findById: (id) => findOne(db, eq(projects.id, id)),
    findByRepo: (repo) => findOne(db, eq(projects.repo, repo)),
    findByTokenHash: (tokenHash) => findOne(db, eq(projects.tokenHash, tokenHash)),
  };
}
