import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { orgs } from '../db/schema.ts';
import type { OrgRepository } from '../ports/org-repository.ts';

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
