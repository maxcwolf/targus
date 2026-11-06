import { z } from 'zod';

import { ImageHash, SnapshotState } from './snapshot.ts';

/**
 * One story's outcome as computed by the CLI on the CI runner (ADR 0003). A story whose render
 * errored has state `error`, a non-empty `error` and no image (ADR 0004, rule 6); every other
 * state has `error` null.
 */
export const StoryResult = z
  .object({
    storyId: z.string().min(1),
    variant: z.string().min(1).default('default'),
    /** Storybook's component title and story name, for grouping in the review UI. */
    title: z.string().min(1).nullable().default(null),
    name: z.string().min(1).nullable().default(null),
    state: SnapshotState,
    imageHash: ImageHash.nullable(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    diffHash: ImageHash.nullable(),
    diffRatio: z.number().min(0).max(1).nullable(),
    error: z.string().min(1).nullable(),
    /** Every pixel is the same colour, usually a capture taken before the story rendered. */
    blank: z.boolean(),
  })
  .superRefine((result, ctx) => {
    if (result.state === 'error') {
      if (result.error === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['error'],
          message: 'an error result needs a non-empty error message',
        });
      }
      if (result.imageHash !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['imageHash'],
          message: 'an error result has no image, so imageHash must be null',
        });
      }
    } else if (result.error !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['error'],
        message: `a ${result.state} result must have error null; use state "error"`,
      });
    }
  });
export type StoryResult = z.infer<typeof StoryResult>;

/** `POST /api/builds/:id/results` request body: every story's result plus the run duration. */
export const SubmitResultsRequest = z.object({
  results: z.array(StoryResult),
  durationMs: z.number().int().nonnegative(),
});
export type SubmitResultsRequest = z.infer<typeof SubmitResultsRequest>;
