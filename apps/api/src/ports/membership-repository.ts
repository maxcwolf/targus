/** A cached answer to "is this user a member of this org", and when GitHub gave it. */
export interface CachedMembership {
  readonly member: boolean;
  readonly checkedAt: Date;
}

/** The one-hour membership cache, `org_memberships` (plan.md section 5.2). */
export interface MembershipRepository {
  get(userId: string, orgId: string): Promise<CachedMembership | null>;
  /** Insert or replace the cached answer. */
  set(userId: string, orgId: string, member: boolean, checkedAt: Date): Promise<void>;
}
