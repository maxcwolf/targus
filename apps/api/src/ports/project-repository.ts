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

/** `projects`, each joined with its org (ADR 0007: every project hangs off an org). */
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
