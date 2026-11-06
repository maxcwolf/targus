/**
 * `parameters.targus` on a story or in preview.tsx. Every field is optional. The `withTargus`
 * decorator reports it to the CLI, which validates it with `@targus/core`'s `StoryParameters`
 * schema and applies it (ADR 0022); an invalid value makes the story an `error`, never a silent
 * default. This type is that schema's shape, kept here so the app needs no dependency on core
 * (a test checks the two stay equal).
 */
export interface TargusParameters {
  /**
   * Milliseconds to wait after the story renders before the first screenshot, in place of the
   * CLI's `--settle`. From 0 to 10000; a stability retry doubles it.
   */
  readonly delay?: number | undefined;
  /** Leave this story out of capture entirely: no screenshot, not an error. Default false. */
  readonly skip?: boolean | undefined;
}
