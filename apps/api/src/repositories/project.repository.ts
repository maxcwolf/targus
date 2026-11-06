import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { orgs, projects } from '../db/schema.ts';

/** The fields of a project's org that check runs and access checks need. */
export interface ProjectOrg {
  readonly githubOrg: string;
  readonly installationId: number | null;
  /** The installation's account id (ADR 0024); null until read from GitHub. */
  readonly githubAccountId: number | null;
}

/** A project with the org fields the API needs (GitHub App installation for check runs). */
export interface Project {
  readonly id: string;
  readonly orgId: string;
  readonly repo: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly createdAt: Date;
  readonly org: ProjectOrg;
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
   * replaces the org's stored one, so re-running with the installation set fills it in; a
   * different one also clears the org's account id, which belonged to the old installation.
   */
  create(project: NewProject): Promise<Project>;
  /**
   * Store the account id read from the org's installation, unless the org has moved to another
   * installation since it was read (then the id is left for the next check to read again).
   */
  setOrgAccountId(orgId: string, installationId: number, githubAccountId: number): Promise<void>;
  findById(id: string): Promise<Project | null>;
  findByRepo(repo: string): Promise<Project | null>;
  findByTokenHash(tokenHash: string): Promise<Project | null>;
  /** Every project, ordered by name; the review UI filters them by org membership. */
  listAll(): Promise<Project[]>;
}

type Row = Omit<typeof projects.$inferSelect, 'tokenHash'> & ProjectOrg;

function toProject(row: Row): Project {
  const { githubOrg, installationId, githubAccountId, ...project } = row;
  return { ...project, org: { githubOrg, installationId, githubAccountId } };
}

type Db = ReturnType<typeof drizzle>;

function selectProjects(db: Db) {
  return db
    .select({
      id: projects.id,
      orgId: projects.orgId,
      repo: projects.repo,
      name: projects.name,
      defaultBranch: projects.defaultBranch,
      createdAt: projects.createdAt,
      githubOrg: orgs.githubOrg,
      installationId: orgs.installationId,
      githubAccountId: orgs.githubAccountId,
    })
    .from(projects)
    .innerJoin(orgs, eq(orgs.id, projects.orgId));
}

async function findOne(db: Db, where: SQL): Promise<Project | null> {
  const row = await selectProjects(db).where(where).get();
  return row === undefined ? null : toProject(row);
}

/** The account id stays only while the installation it was read from does. */
function keepAccountIdIfSame(installationId: number): SQL {
  return sql`CASE WHEN ${orgs.installationId} = ${installationId} THEN ${orgs.githubAccountId} ELSE NULL END`;
}

function upsertOrg(
  db: Db,
  project: NewProject,
): Promise<{ id: string; installationId: number | null; githubAccountId: number | null }> {
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
          : {
              installationId: project.installationId,
              githubAccountId: keepAccountIdIfSame(project.installationId),
            },
    })
    .returning({
      id: orgs.id,
      installationId: orgs.installationId,
      githubAccountId: orgs.githubAccountId,
    })
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
        githubAccountId: org.githubAccountId,
      });
    },
    async setOrgAccountId(orgId, installationId, githubAccountId) {
      await db
        .update(orgs)
        .set({ githubAccountId })
        .where(and(eq(orgs.id, orgId), eq(orgs.installationId, installationId)));
    },
    findById: (id) => findOne(db, eq(projects.id, id)),
    findByRepo: (repo) => findOne(db, eq(projects.repo, repo)),
    findByTokenHash: (tokenHash) => findOne(db, eq(projects.tokenHash, tokenHash)),
    async listAll() {
      const rows = await selectProjects(db).orderBy(asc(projects.name), asc(projects.id));
      return rows.map(toProject);
    },
  };
}
