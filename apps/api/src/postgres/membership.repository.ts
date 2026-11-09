import { and, eq } from 'drizzle-orm';

import type { MembershipRepository } from '../ports/membership-repository.ts';
import type { PostgresDatabase } from './database.ts';
import { orgMemberships } from './schema.ts';

/** Postgres adapter for `org_memberships`, the one-hour membership cache. */
export function createPostgresMembershipRepository(db: PostgresDatabase): MembershipRepository {
  return {
    async get(userId, orgId) {
      const [row] = await db
        .select({ member: orgMemberships.member, checkedAt: orgMemberships.checkedAt })
        .from(orgMemberships)
        .where(and(eq(orgMemberships.userId, userId), eq(orgMemberships.orgId, orgId)));
      return row ?? null;
    },
    async set(userId, orgId, member, checkedAt) {
      await db
        .insert(orgMemberships)
        .values({ userId, orgId, member, checkedAt })
        .onConflictDoUpdate({
          target: [orgMemberships.userId, orgMemberships.orgId],
          set: { member, checkedAt },
        });
    },
  };
}
