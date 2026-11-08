import { z } from 'zod';

import {
  maxStoryDelayMs,
  parseStoryParameters,
  type ParsedStoryParameters,
} from './story-parameters.ts';

/**
 * The `parameters.chromatic` keys targus honours when a story has no `parameters.targus`, so
 * stories written for Chromatic capture unchanged (ADR 0037). Unknown keys are ignored; a known
 * key with a bad value is an error, as for `parameters.targus`.
 */
export const ChromaticParameters = z.object({
  disable: z.boolean().optional(),
  disableSnapshot: z.boolean().optional(),
  delay: z.number().min(0).max(maxStoryDelayMs).optional(),
});
export type ChromaticParameters = z.infer<typeof ChromaticParameters>;

/** A story's raw `parameters.targus` and `parameters.chromatic`, as the preview reports them. */
export interface RawCaptureParameters {
  readonly targus?: unknown;
  readonly chromatic?: unknown;
}

function isSet(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function issuesText(issues: readonly z.core.$ZodIssue[]): string {
  return issues
    .map((issue) =>
      issue.path.length === 0 ? issue.message : `${issue.path.join('.')}: ${issue.message}`,
    )
    .join('; ');
}

/**
 * The capture parameters of a story: `parameters.targus` when the story sets it, else the
 * Chromatic equivalents (`disable` or `disableSnapshot` skip it, `delay` delays it), else the
 * defaults.
 */
export function parseCaptureParameters(raw: RawCaptureParameters): ParsedStoryParameters {
  if (isSet(raw.targus) || !isSet(raw.chromatic)) return parseStoryParameters(raw.targus);
  const parsed = ChromaticParameters.safeParse(raw.chromatic);
  if (!parsed.success) {
    return {
      ok: false,
      message: `invalid parameters.chromatic: ${issuesText(parsed.error.issues)}`,
    };
  }
  const { disable, disableSnapshot, delay } = parsed.data;
  return {
    ok: true,
    parameters: { delay: delay ?? null, skip: disable === true || disableSnapshot === true },
  };
}
