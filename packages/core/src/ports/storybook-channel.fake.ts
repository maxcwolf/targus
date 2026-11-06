import type { StoryIndexEntry, StorybookChannel, StorySelection } from './storybook-channel.ts';

/** What selecting a story does in a `FakeStorybookChannel`: a selection result or a timeout. */
export type FakeStoryOutcome = StorySelection | { readonly kind: 'timeout' };

/** A `StorybookChannel` with a fixed index and scripted per-story outcomes. */
export interface FakeStorybookChannel extends StorybookChannel {
  /** Story ids passed to `selectStory`, oldest first. */
  readonly selected: readonly string[];
  /** Whether `close()` has been called. */
  readonly closed: boolean;
  /** Script what selecting `storyId` does from now on. The default is `rendered`. */
  setOutcome(storyId: string, outcome: FakeStoryOutcome): void;
}

export function createFakeStorybookChannel(
  index: readonly StoryIndexEntry[] = [],
): FakeStorybookChannel {
  const selected: string[] = [];
  const outcomes = new Map<string, FakeStoryOutcome>();
  let closed = false;

  return {
    selected,
    get closed() {
      return closed;
    },
    setOutcome: (storyId, outcome) => {
      outcomes.set(storyId, outcome);
    },
    getIndex: () => Promise.resolve(index.map((entry) => ({ ...entry }))),
    selectStory: (storyId, timeoutMs) => {
      selected.push(storyId);
      const outcome = outcomes.get(storyId) ?? { kind: 'rendered' };
      if (outcome.kind === 'timeout') {
        return Promise.reject(new Error(`timeout after ${timeoutMs}ms waiting for ${storyId}`));
      }
      return Promise.resolve(outcome);
    },
    close: () => {
      closed = true;
      return Promise.resolve();
    },
  };
}
