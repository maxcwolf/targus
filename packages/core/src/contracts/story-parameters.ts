import { z } from 'zod';

import type { StoryCaptureParameters } from '../ports/storybook-channel.ts';

/** The longest `parameters.targus.delay` a story may ask for (ADR 0022). */
export const maxStoryDelayMs = 10_000;

/** Channel event the `withTargus` decorator emits once a story has committed (ADR 0022). */
export const storyParametersEvent = 'targus/storyParameters';

/**
 * `parameters.targus` as a story sets it. Unknown keys are ignored so a newer decorator field
 * does not break an older CLI; a known key with a bad value is an error, never a silent default.
 */
export const StoryParameters = z.object({
  delay: z.number().min(0).max(maxStoryDelayMs).optional(),
  skip: z.boolean().optional(),
});
export type StoryParameters = z.infer<typeof StoryParameters>;

/**
 * The `targus/storyParameters` payload: the story id and its raw `parameters.targus`. The app
 * forwards the value unvalidated so the CLI, which owns the bounds, can reject it by name.
 */
export const StoryParametersPayload = z.object({
  storyId: z.string().min(1),
  targus: z.unknown(),
});
export type StoryParametersPayload = z.infer<typeof StoryParametersPayload>;

export type ParsedStoryParameters =
  | { readonly ok: true; readonly parameters: StoryCaptureParameters }
  | { readonly ok: false; readonly message: string };

/** Validate a story's raw `parameters.targus`. Absent (`undefined` or `null`) means defaults. */
export function parseStoryParameters(targus: unknown): ParsedStoryParameters {
  if (targus === undefined || targus === null) {
    return { ok: true, parameters: { delay: null, skip: false } };
  }
  const parsed = StoryParameters.safeParse(targus);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) =>
      issue.path.length === 0 ? issue.message : `${issue.path.join('.')}: ${issue.message}`,
    );
    return { ok: false, message: `invalid parameters.targus: ${issues.join('; ')}` };
  }
  const { delay, skip } = parsed.data;
  return { ok: true, parameters: { delay: delay ?? null, skip: skip ?? false } };
}
