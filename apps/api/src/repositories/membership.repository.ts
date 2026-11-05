import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { orgMemberships } from '../db/schema.js';

/** A cached answer to "is this user a member of this org", and when GitHub gave it. */
export interface CachedMembership {
  readonly member: boolean;
  readonly checkedAt: Date;
}

export interface MembershipRepository {
  get(userId: string, orgId: string): Promise<CachedMembership | null>;
  /** Insert or replace the cached answer. */
  set(userId: string, orgId: string, member: boolean, checkedAt: Date): Promise<void>;
}

/** D1 adapter for `org_memberships`, the one-hour membership cache (plan.md section 5.2). */
export function createMembershipRepository(database: D1Database): MembershipRepository {
  const db = drizzle(database);

  return {
    async get(userId, orgId) {
      const row = await db
        .select({ member: orgMemberships.member, checkedAt: orgMemberships.checkedAt })
        .from(orgMemberships)
        .where(and(eq(orgMemberships.userId, userId), eq(orgMemberships.orgId, orgId)))
        .get();
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
