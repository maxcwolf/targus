import type { Approval } from '@targus/core';

/** The story and hash pair an approval is of: its identity. */
export type ApprovalIdentity = Pick<
  Approval,
  'projectId' | 'storyId' | 'variant' | 'fromHash' | 'toHash'
>;

/** The `approvals` table (plan.md section 6, rule 3). */
export interface ApprovalRepository {
  /** Every approval of a project, oldest first. */
  listForProject(projectId: string): Promise<Approval[]>;
  /**
   * Record an approval unless the project already has one of the same story, variant and hash
   * pair, in which case the existing one stands. `id` comes from the `IdGenerator` port.
   */
  create(id: string, approval: Approval): Promise<void>;
  /** Remove every approval of this story moving `fromHash` to `toHash`. */
  delete(
    projectId: string,
    storyId: string,
    variant: string,
    fromHash: string | null,
    toHash: string,
  ): Promise<void>;
}
