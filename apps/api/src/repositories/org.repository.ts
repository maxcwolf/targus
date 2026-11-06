import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { orgs } from '../db/schema.ts';

/** A GitHub organisation that has installed targus. */
export interface Org {
  readonly id: string;
  readonly githubOrg: string;
  readonly installationId: number | null;
  /** The installation's account id (ADR 0024); null until read from GitHub. */
  readonly githubAccountId: number | null;
  readonly createdAt: Date;
}

export interface OrgRepository {
  insert(org: Org): Promise<void>;
  findById(id: string): Promise<Org | null>;
}

/**
 * D1 adapter for the `orgs` table. Ids and timestamps are supplied by the caller (from the
 * `IdGenerator` and `Clock` ports), so the repository holds no business rules.
 */
export function createOrgRepository(database: D1Database): OrgRepository {
  const db = drizzle(database);

  return {
    async insert(org) {
      await db.insert(orgs).values(org);
    },
    async findById(id) {
      const row = await db.select().from(orgs).where(eq(orgs.id, id)).get();
      return row ?? null;
    },
  };
}
