/** `parameters.targus` on a story or in preview.tsx. Every field is optional. */
export interface TargusParameters {
  /** Milliseconds to wait after `storyRendered` before the first screenshot. Default 300. */
  readonly delay?: number;
  /** Leave this story out of capture entirely. Default false. */
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
