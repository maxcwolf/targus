import { z } from 'zod';

import type { CaptureMode, ModeViewport } from '../ports/storybook-channel.ts';

/** A global's value as a mode sets it; Storybook carries globals in the URL as plain values. */
const GlobalValue = z.union([z.string(), z.number(), z.boolean()]);

const Size = z.number().int().min(1).max(10_000);

/**
 * A mode's viewport: a width (the run's height is kept), or a width and height in CSS pixels.
 * Named viewports from Storybook's viewport addon are not resolved.
 */
const Viewport = z.union([
  Size,
  z.object({ width: Size, height: Size }),
  z.string().regex(/^\d+px$/, 'a named viewport is not supported: give { width, height }'),
]);

/** One mode as Chromatic and `parameters.targus.modes` write it: globals, a viewport, disable. */
const Mode = z
  .object({ disable: z.boolean().optional(), viewport: Viewport.optional() })
  .catchall(GlobalValue);

/** `modes`: named modes, each captured as its own variant (web-plan.md step W5). */
export const Modes = z.record(
  z
    .string()
    .min(1)
    .max(60)
    .refine((name) => !/\p{Cc}/u.test(name), 'no control characters'),
  Mode,
);
export type Modes = z.infer<typeof Modes>;

function modeViewport(viewport: z.infer<typeof Viewport> | undefined): ModeViewport | null {
  if (viewport === undefined) return null;
  if (typeof viewport === 'number') return { width: viewport, height: null };
  if (typeof viewport === 'string') return { width: Number.parseInt(viewport, 10), height: null };
  return viewport;
}

/** The modes a story is captured in, in the order it lists them, without disabled ones. */
export function toCaptureModes(modes: Modes): CaptureMode[] {
  return Object.entries(modes).flatMap(([name, { disable, viewport, ...globals }]) =>
    disable === true ? [] : [{ name, globals, viewport: modeViewport(viewport) }],
  );
}
