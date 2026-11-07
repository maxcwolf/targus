import {
  createFakeClock,
  createFakeDeviceDriver,
  createFakeStorybookChannel,
  StoryResult,
  SubmitResultsRequest,
  type StorybookChannel,
} from '@targus/core';
import { afterEach, describe, expect, it } from 'vitest';

import { WsStorybookChannel } from '../adapters/ws-channel.adapter.ts';
import { connectApp } from '../adapters/ws-channel.scripted-app.ts';
import { captureStories, noErrorMessage, type CaptureResult } from '../capture/capture-stories.ts';
import { errorResult } from './story-result.ts';

// A story that throws `new Error()` reports an empty message. The server refuses an error result
// without one, and with it the whole results body, so the CLI never sends one empty.

const story = { id: 'chat--mine', title: 'Chat', name: 'Mine' };

let server: WsStorybookChannel | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

function capture(channel: StorybookChannel) {
  return captureStories({
    channel,
    driver: createFakeDeviceDriver(),
    stories: [story],
    options: { settleMs: 1, stabilityGapMs: 1, renderTimeoutMs: 2000, maxAttempts: 1 },
    clock: createFakeClock(),
    sleep: () => Promise.resolve(),
    hash: () => 'h',
    compareImages: () => ({ ratio: 0, diffPng: null }),
  });
}

/** The results body for `stories`, as `targus run` would submit it, checked by the contract. */
function submitted(stories: readonly CaptureResult[]) {
  return SubmitResultsRequest.safeParse({
    results: stories.map((story) => errorResult(story, undefined)),
    durationMs: 1,
    threshold: 0.001,
  });
}

describe('a story error with an empty message', () => {
  it('reaches the results as a message the server accepts, from the app over the channel', async () => {
    server = await WsStorybookChannel.listen({
      port: 0,
      host: '127.0.0.1',
      connectTimeoutMs: 2000,
      reportGraceMs: 2000,
    });
    const app = await connectApp(server.port);
    const report = capture(server);
    await app.nextMessage();
    app.send('storyRendered', story.id);
    app.send('targus/storyError', { storyId: story.id, message: '', stack: null });

    const { stories } = await report;

    expect(stories.map((result) => result.error)).toEqual([noErrorMessage]);
    const body = submitted(stories);
    expect(body.success).toBe(true);
    expect(body.data?.results[0]).toMatchObject({ state: 'error', error: noErrorMessage });
  });

  it('is replaced when the channel rejects with an error that has no message', async () => {
    const channel = createFakeStorybookChannel([story]);
    channel.selectStory = () => Promise.reject(new TypeError());

    const { stories } = await capture(channel);

    expect(stories[0]?.error).toBe('TypeError thrown with no message');
    expect(submitted(stories).success).toBe(true);
  });

  it('is replaced in a capture an older CLI wrote with the empty message kept', () => {
    const captured: CaptureResult = {
      ...story,
      png: null,
      hash: null,
      width: 0,
      height: 0,
      renderMs: 0,
      captureMs: 0,
      attempts: 0,
      stable: false,
      blank: null,
      error: ' ',
    };

    expect(StoryResult.parse(errorResult(captured, undefined)).error).toBe(noErrorMessage);
  });
});
