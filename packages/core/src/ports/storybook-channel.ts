/** One entry of the story index the app reports over `RN_GET_INDEX`. */
export interface StoryIndexEntry {
  readonly id: string;
  readonly title: string;
  readonly name: string;
}

/** What happened after the CLI asked the app to show a story. */
export type StorySelection =
  { readonly kind: 'rendered' } | { readonly kind: 'error'; readonly message: string };

/**
 * The Storybook channel between the CLI and the app (ADR 0008). The adapter,
 * `WsStorybookChannel` in `packages/cli`, hosts the websocket server the app connects to.
 */
export interface StorybookChannel {
  /** Wait for the app to connect, then return the index it actually loaded. */
  getIndex(): Promise<readonly StoryIndexEntry[]>;
  /**
   * Emit `setCurrentStory` and resolve on `storyRendered`/`storyUnchanged` (`rendered`) or on
   * `targus/storyError` (`error`). Rejects after `timeoutMs`. `rendered` means React committed,
   * not that the frame was painted, so callers still apply the settle delay.
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
