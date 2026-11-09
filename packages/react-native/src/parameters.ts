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
  /**
   * Named modes, each captured as its own variant, as Chromatic writes them: globals to set,
   * an optional `viewport`, and `disable`. Web captures only for now; native ignores them.
   */
  readonly modes?: Record<string, TargusMode> | undefined;
  /**
   * System text sizes to capture the story at on a device, beside its default capture: each is
   * its own snapshot, named after the size (`<story id>@ax5`). A web capture ignores it.
   */
  readonly contentSizes?: TargusContentSize[] | undefined;
}

/** A mode viewport: a width in CSS pixels (`390` or `'390px'`) or `{ width, height }`. */
export type TargusModeViewport = string | number | { width: number; height: number };

/** One mode: the globals it sets (`theme: 'dark'`), plus `viewport` and `disable`. */
export type TargusMode = Flatten<
  Record<string, string | number | boolean> & {
    disable?: boolean | undefined;
    viewport?: TargusModeViewport | undefined;
  }
>;

/**
 * A device's system text size, as Settings > Accessibility > Larger Text sets it: the seven
 * standard sizes, then the five accessibility sizes. `l` is the default.
 */
export type TargusContentSize =
  'xs' | 's' | 'm' | 'l' | 'xl' | 'xxl' | 'xxxl' | 'ax1' | 'ax2' | 'ax3' | 'ax4' | 'ax5';

/** One object type from an intersection, as zod infers a schema with a catchall. */
type Flatten<T> = { [K in keyof T]: T[K] } & {};
