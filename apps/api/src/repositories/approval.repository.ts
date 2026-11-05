import type { Approval } from '@targus/core';
import { and, asc, eq, isNull, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { approvals } from '../db/schema.js';

export interface ApprovalRepository {
  /** Every approval of a project, oldest first. */
  listForProject(projectId: string): Promise<Approval[]>;
  /** Record an approval; `id` comes from the `IdGenerator` port. */
  create(id: string, approval: Approval): Promise<void>;
  /** Whether the project has an approval of this story moving `fromHash` to `toHash`. */
  exists(
    projectId: string,
    storyId: string,
    variant: string,
    fromHash: string | null,
    toHash: string,
  ): Promise<boolean>;
  /** Remove every approval of this story moving `fromHash` to `toHash`. */
  delete(
    projectId: string,
    storyId: string,
    variant: string,
    fromHash: string | null,
    toHash: string,
  ): Promise<void>;
}

/** One hash pair of one story; a null `fromHash` (a `new` story) matches SQL NULL. */
function pairOf(
  projectId: string,
  storyId: string,
  variant: string,
  fromHash: string | null,
  toHash: string,
): SQL | undefined {
  return and(
    eq(approvals.projectId, projectId),
    eq(approvals.storyId, storyId),
    eq(approvals.variant, variant),
    fromHash === null ? isNull(approvals.fromHash) : eq(approvals.fromHash, fromHash),
    eq(approvals.toHash, toHash),
  );
}

/** D1 adapter for `approvals` (plan.md section 6, rule 3). */
export function createApprovalRepository(database: D1Database): ApprovalRepository {
  const db = drizzle(database);

  return {
    async listForProject(projectId) {
      const rows = await db
        .select()
        .from(approvals)
        .where(eq(approvals.projectId, projectId))
        .orderBy(asc(approvals.approvedAt), asc(approvals.id));
      return rows.map((row) => ({
        projectId: row.projectId,
        storyId: row.storyId,
        variant: row.variant,
        fromHash: row.fromHash,
        toHash: row.toHash,
        approvedBy: row.approvedBy,
        approvedAt: row.approvedAt.toISOString(),
      }));
    },
    async create(id, approval) {
      await db
        .insert(approvals)
        .values({ ...approval, id, approvedAt: new Date(approval.approvedAt) });
    },
    async exists(...pair) {
      const row = await db
        .select({ id: approvals.id })
        .from(approvals)
        .where(pairOf(...pair))
        .limit(1)
        .get();
      return row !== undefined;
    },
    async delete(...pair) {
      await db.delete(approvals).where(pairOf(...pair));
    },
  };
}
