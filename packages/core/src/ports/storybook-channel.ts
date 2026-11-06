/** One entry of the story index the app reports over `RN_GET_INDEX`. */
export interface StoryIndexEntry {
  readonly id: string;
  readonly title: string;
  readonly name: string;
}

/**
 * A story's validated `parameters.targus`, as the app reported it after the story committed
 * (ADR 0022). `delay` is `null` when the story set none, so the capture uses `--settle`.
 */
export interface StoryCaptureParameters {
  readonly delay: number | null;
  readonly skip: boolean;
}

/**
 * What happened after the CLI asked the app to show a story. A `rendered` selection carries
 * `parameters` when the app's `withTargus` decorator reported them; without the decorator it has
 * none, and the capture applies the defaults.
 */
export type StorySelection =
  | { readonly kind: 'rendered'; readonly parameters?: StoryCaptureParameters }
  | { readonly kind: 'error'; readonly message: string };

/**
 * The Storybook channel between the CLI and the app (ADR 0008). The adapter,
 * `WsStorybookChannel` in `packages/cli`, hosts the websocket server the app connects to.
 */
export interface StorybookChannel {
  /** Wait for the app to connect, then return the index it actually loaded. */
  getIndex(): Promise<readonly StoryIndexEntry[]>;
  /**
   * Emit `setCurrentStory` and resolve on `storyRendered`/`storyUnchanged` (`rendered`) or on
   * `targus/storyError` (`error`). When the app runs the `withTargus` decorator, `rendered` waits
   * for its `targus/storyParameters` report and carries the story's parameters; an invalid
   * `parameters.targus` is an `error`. Rejects after `timeoutMs`. `rendered` means React
   * committed, not that the frame was painted, so callers still apply the settle delay.
   */
  selectStory(storyId: string, timeoutMs: number): Promise<StorySelection>;
  /**
   * Resolve when the app, having connected, drops its last connection (ADR 0021). Never resolves
   * if the app never connects or when the CLI itself calls `close`.
   */
  whenDisconnected(): Promise<void>;
  /** Close the server and every client connection. */
  close(): Promise<void>;
}
