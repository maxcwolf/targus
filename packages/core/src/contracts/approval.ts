import { z } from 'zod';

import { ImageHash } from './snapshot.ts';

/**
 * A reviewer's approval of one story's change, as stored in the `approvals` table (plan.md
 * section 6, rule 3). Any later snapshot of the same project, story and variant that moves from
 * `fromHash` to `toHash` is auto-approved. `fromHash` is `null` when a `new` story was approved.
 */
export const Approval = z.object({
  projectId: z.string().min(1),
  storyId: z.string().min(1),
  variant: z.string().min(1),
  fromHash: ImageHash.nullable(),
  toHash: ImageHash,
  approvedBy: z.string().min(1),
  approvedAt: z.iso.datetime(),
});
export type Approval = z.infer<typeof Approval>;
