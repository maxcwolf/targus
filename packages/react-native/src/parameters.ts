/**
 * `parameters.targus` on a story or in preview.tsx. Every field is optional. The `withTargus`
 * decorator reports it to the CLI, which validates it and applies it (ADR 0022); an invalid
 * value makes the story an `error`, never a silent default.
 */
export interface TargusParameters {
  /**
   * Milliseconds to wait after the story renders before the first screenshot, in place of the
   * CLI's `--settle` (default 300). From 0 to 10000; a stability retry doubles it.
   */
  readonly delay?: number;
  /** Leave this story out of capture entirely: no screenshot, not an error. Default false. */
  readonly skip?: boolean;
}

/** `TargusParameters` with every default applied. */
export type ResolvedTargusParameters = Required<TargusParameters>;

export const defaultTargusParameters: ResolvedTargusParameters = { delay: 300, skip: false };

/**
 * Read `parameters.targus` from a story's Storybook parameters and apply defaults. Tolerates a
 * missing or malformed value so one bad story cannot break capture of the others.
 */
export function resolveTargusParameters(parameters: unknown): ResolvedTargusParameters {
  const targus = isRecord(parameters) ? parameters.targus : undefined;
  if (!isRecord(targus)) return defaultTargusParameters;

  const { delay, skip } = targus;
  return {
    delay: typeof delay === 'number' && delay >= 0 ? delay : defaultTargusParameters.delay,
    skip: typeof skip === 'boolean' ? skip : defaultTargusParameters.skip,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
