import type { Approval } from '@targus/core';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { approvals } from '../db/schema.js';

export interface ApprovalRepository {
  /** Every approval of a project, oldest first. */
  listForProject(projectId: string): Promise<Approval[]>;
  /** Record an approval; `id` comes from the `IdGenerator` port. */
  create(id: string, approval: Approval): Promise<void>;
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
  };
}
