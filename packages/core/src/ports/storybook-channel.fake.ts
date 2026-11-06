import type { StoryIndexEntry, StorybookChannel, StorySelection } from './storybook-channel.ts';

/**
 * What selecting a story does in a `FakeStorybookChannel`: a selection result, a timeout, or the
 * app dropping its connection, as a crash mid-render would (the selection never answers).
 */
export type FakeStoryOutcome =
  StorySelection | { readonly kind: 'timeout' } | { readonly kind: 'disconnect' };

/** A `StorybookChannel` with a fixed index and scripted per-story outcomes. */
export interface FakeStorybookChannel extends StorybookChannel {
  /** Story ids passed to `selectStory`, oldest first. */
  readonly selected: readonly string[];
  /** Whether `close()` has been called. */
  readonly closed: boolean;
  /** Script what selecting `storyId` does from now on. The default is `rendered`. */
  setOutcome(storyId: string, outcome: FakeStoryOutcome): void;
  /** Drop the app's connection: `whenDisconnected()` resolves. */
  disconnect(): void;
}

export function createFakeStorybookChannel(
  index: readonly StoryIndexEntry[] = [],
): FakeStorybookChannel {
  const selected: string[] = [];
  const outcomes = new Map<string, FakeStoryOutcome>();
  const unanswered: ((error: Error) => void)[] = [];
  let closed = false;
  let disconnect = (): void => undefined;
  const disconnected = new Promise<void>((resolve) => {
    disconnect = resolve;
  });

  return {
    selected,
    get closed() {
      return closed;
    },
    setOutcome: (storyId, outcome) => {
      outcomes.set(storyId, outcome);
    },
    disconnect: () => {
      disconnect();
    },
    whenDisconnected: () => disconnected,
    getIndex: () => Promise.resolve(index.map((entry) => ({ ...entry }))),
    selectStory: (storyId, timeoutMs) => {
      selected.push(storyId);
      const outcome = outcomes.get(storyId) ?? { kind: 'rendered' };
      if (outcome.kind === 'timeout') {
        return Promise.reject(new Error(`timeout after ${timeoutMs}ms waiting for ${storyId}`));
      }
      if (outcome.kind === 'disconnect') {
        disconnect();
        // Like the real channel: nothing answers, and close() rejects the wait.
        return new Promise<StorySelection>((_resolve, reject) => unanswered.push(reject));
      }
      return Promise.resolve(outcome);
    },
    close: () => {
      closed = true;
      for (const reject of unanswered.splice(0)) reject(new Error('channel closed'));
      return Promise.resolve();
    },
  };
}
