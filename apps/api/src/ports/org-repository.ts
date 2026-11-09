/** A GitHub organisation that has installed targus. */
export interface Org {
  readonly id: string;
  readonly githubOrg: string;
  readonly installationId: number | null;
  /** The installation's account id (ADR 0024); null until read from GitHub. */
  readonly githubAccountId: number | null;
  readonly createdAt: Date;
}

/** The `orgs` table on its own; projects reach their org through `ProjectRepository`. */
export interface OrgRepository {
  insert(org: Org): Promise<void>;
  findById(id: string): Promise<Org | null>;
}
