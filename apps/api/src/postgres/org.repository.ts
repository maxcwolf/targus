import { eq } from 'drizzle-orm';

import type { OrgRepository } from '../ports/org-repository.ts';
import type { PostgresDatabase } from './database.ts';
import { orgs } from './schema.ts';

/** Postgres adapter for the `orgs` table; ids and timestamps come from the caller. */
export function createPostgresOrgRepository(db: PostgresDatabase): OrgRepository {
  return {
    async insert(org) {
      await db.insert(orgs).values(org);
    },
    async findById(id) {
      const [row] = await db.select().from(orgs).where(eq(orgs.id, id));
      return row ?? null;
    },
  };
}
