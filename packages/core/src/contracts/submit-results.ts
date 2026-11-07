import { z } from 'zod';

import { DiffThreshold } from './create-build.ts';
import { ImageHash, SnapshotState } from './snapshot.ts';

const StoryResultFields = z.object({
  storyId: z.string().min(1),
  variant: z.string().min(1).default('default'),
  /** Storybook's component title and story name, for grouping in the review UI. */
  title: z.string().min(1).nullable().default(null),
  name: z.string().min(1).nullable().default(null),
  state: SnapshotState,
  imageHash: ImageHash.nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  /** The baseline the CLI diffed against: the one `POST /api/builds` returned for the story. */
  baselineHash: ImageHash.nullable(),
  diffHash: ImageHash.nullable(),
  diffRatio: z.number().min(0).max(1).nullable(),
  error: z.string().min(1).nullable(),
  /** Every pixel is the same colour, usually a capture taken before the story rendered. */
  blank: z.boolean(),
});
type StoryResultFields = z.infer<typeof StoryResultFields>;

/** A result's `error` matches its state: required for `error`, null for every other state. */
function checkError(result: StoryResultFields, ctx: z.RefinementCtx): void {
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
}

/** A diff is measured against a baseline, so a result without one has no diff (ADR 0032). */
function checkDiffHasBaseline(result: StoryResultFields, ctx: z.RefinementCtx): void {
  if (result.baselineHash !== null) return;
  for (const field of ['diffRatio', 'diffHash'] as const) {
    if (result[field] !== null) {
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: `a result with no baselineHash was not diffed, so ${field} must be null`,
      });
    }
  }
}

/**
 * One story's outcome as measured by the CLI on the CI runner (ADR 0016). A story whose render
 * errored has state `error`, a non-empty `error` and no image (ADR 0004, rule 6); every other
 * state has `error` null. `baselineHash` is the baseline `POST /api/builds` gave the CLI for the
 * story, which its `diffRatio` and `diffHash` were measured against, or null when it gave none.
 * The server keeps the diff only when that is still the story's baseline at submit (ADR 0032).
 */
export const StoryResult = StoryResultFields.superRefine((result, ctx) => {
  checkError(result, ctx);
  checkDiffHasBaseline(result, ctx);
});
export type StoryResult = z.infer<typeof StoryResult>;

/**
 * `POST /api/builds/:id/results` request body: every story's result, the run duration, and the
 * threshold the CLI diffed with, which is the one `POST /api/builds` returned. The server
 * rejects results measured with any other threshold (ADR 0028). At least one result: with none,
 * every baseline story would be `removed`, which needs no review, so a broken story glob would
 * pass the check and, on the default branch, become the next baseline.
 */
export const SubmitResultsRequest = z.object({
  results: z
    .array(StoryResult)
    .min(1, 'no story results: an empty build would mark every baseline story removed'),
  durationMs: z.number().int().nonnegative(),
  threshold: DiffThreshold,
});
export type SubmitResultsRequest = z.infer<typeof SubmitResultsRequest>;
