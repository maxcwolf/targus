import { z } from 'zod';

/** SHA-256 of the PNG bytes, lowercase hex. Images are content-addressed by this. */
export const ImageHash = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'expected a lowercase sha256 hex digest');
export type ImageHash = z.infer<typeof ImageHash>;

/**
 * Result of comparing a story's capture with its baseline (plan.md section 6, rule 2).
 * `error` means the story's render errored, so there is no image (ADR 0004, rule 6).
 */
export const SnapshotState = z.enum([
  'unchanged',
  'changed',
  'new',
  'removed',
  'unstable',
  'error',
]);
export type SnapshotState = z.infer<typeof SnapshotState>;

/**
 * Human review of a snapshot. Only `changed` and `new` snapshots wait on a reviewer. `error`
 * snapshots stay `pending` but are never approvable; they clear only when a later build
 * captures the story.
 */
export const ReviewState = z.enum(['pending', 'approved', 'denied']);
export type ReviewState = z.infer<typeof ReviewState>;

/** One story in one build, as stored in the `snapshots` table. */
export const Snapshot = z.object({
  id: z.string().min(1),
  buildId: z.string().min(1),
  storyId: z.string().min(1),
  variant: z.string().min(1),
  /** Storybook's component title and story name; null for a `removed` story. */
  title: z.string().min(1).nullable(),
  name: z.string().min(1).nullable(),
  imageHash: ImageHash.nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  baselineHash: ImageHash.nullable(),
  diffHash: ImageHash.nullable(),
  diffRatio: z.number().min(0).max(1).nullable(),
  state: SnapshotState,
  review: ReviewState,
  reviewedBy: z.string().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
});
export type Snapshot = z.infer<typeof Snapshot>;
