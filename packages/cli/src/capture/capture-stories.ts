import type { Clock, DeviceDriver, StoryIndexEntry, StorybookChannel } from '@targus/core';

import { readPngSize } from './png.ts';

export interface CaptureOptions {
  /** Wait after `storyRendered` before the first screenshot; doubled on each retry. */
  readonly settleMs: number;
  /** Gap between the two screenshots of the stability check. */
  readonly stabilityGapMs: number;
  readonly renderTimeoutMs: number;
  readonly maxAttempts: number;
  /** Keep only stories whose id or title contains this text. */
  readonly filter?: string;
  /** Capture at most this many stories (after `filter`). */
  readonly limit?: number;
}

/** How two captures compare: `ratio` of differing pixels, 0 when identical. */
export interface ImageComparison {
  readonly ratio: number;
  readonly diffPng: Uint8Array | null;
}

export type CompareImages = (a: Uint8Array, b: Uint8Array) => ImageComparison;

export interface CaptureResult {
  readonly id: string;
  readonly title: string;
  readonly name: string;
  /** The first screenshot of the last attempt, or `null` when the story errored. */
  readonly png: Uint8Array | null;
  readonly hash: string | null;
  readonly width: number;
  readonly height: number;
  /** `setCurrentStory` until `storyRendered` (or the error). */
  readonly renderMs: number;
  /** `setCurrentStory` until the capture was done, settle and retries included. */
  readonly captureMs: number;
  readonly attempts: number;
  /** Two captures `stabilityGapMs` apart were identical. `false` means `unstable`. */
  readonly stable: boolean;
  /** Single-colour capture; `null` when no `isBlank` check was supplied. */
  readonly blank: boolean | null;
  readonly error: string | null;
}

export interface CaptureReport {
  readonly stories: readonly CaptureResult[];
  readonly startedAt: string;
  readonly durationMs: number;
}

export interface CaptureProgress {
  readonly index: number;
  readonly total: number;
  readonly result: CaptureResult;
}

export interface CaptureStoriesInput {
  readonly channel: StorybookChannel;
  readonly driver: DeviceDriver;
  /** Stories to capture; defaults to the index the app reports. */
  readonly stories?: readonly StoryIndexEntry[];
  readonly options: CaptureOptions;
  readonly clock: Clock;
  readonly sleep: (ms: number) => Promise<void>;
  readonly hash: (bytes: Uint8Array) => string;
  readonly compareImages: CompareImages;
  readonly isBlank?: (png: Uint8Array) => boolean;
  readonly onProgress?: (progress: CaptureProgress) => void;
}

/** Keep the stories matching `filter`, then the first `limit` of them. */
export function selectStories(
  stories: readonly StoryIndexEntry[],
  { filter, limit }: Pick<CaptureOptions, 'filter' | 'limit'>,
): readonly StoryIndexEntry[] {
  const matching =
    filter === undefined
      ? stories
      : stories.filter((story) => story.id.includes(filter) || story.title.includes(filter));
  return limit === undefined ? matching : matching.slice(0, limit);
}

/**
 * The capture loop proven by the capture spike (docs/spike-m0.md): select each story, wait for
 * the app to commit it, settle, take two screenshots `stabilityGapMs` apart and keep the first
 * if they match. On a mismatch retry with a doubled settle up to `maxAttempts`, then mark the story
 * unstable. Channel errors and timeouts are recorded per story and never thrown.
 */
export async function captureStories(input: CaptureStoriesInput): Promise<CaptureReport> {
  const { channel, clock, options } = input;
  const startedAt = clock.now();
  const stories = selectStories(input.stories ?? (await channel.getIndex()), options);
  const results: CaptureResult[] = [];
  for (const [index, story] of stories.entries()) {
    const result = await captureStory(input, story);
    results.push(result);
    input.onProgress?.({ index, total: stories.length, result });
  }
  return {
    stories: results,
    startedAt: startedAt.toISOString(),
    durationMs: elapsedMs(clock, startedAt),
  };
}

async function captureStory(
  input: CaptureStoriesInput,
  story: StoryIndexEntry,
): Promise<CaptureResult> {
  const { channel, clock, options } = input;
  const started = clock.now();
  const failed = (error: string, renderMs: number): CaptureResult => ({
    ...emptyResult(story),
    renderMs,
    captureMs: elapsedMs(clock, started),
    error,
  });
  let renderMs: number | null = null;
  try {
    const selection = await channel.selectStory(story.id, options.renderTimeoutMs);
    renderMs = elapsedMs(clock, started);
    if (selection.kind === 'error') return failed(selection.message, renderMs);
    const settled = await settle(input);
    return {
      ...emptyResult(story),
      ...settled,
      ...readPngSize(settled.png),
      hash: input.hash(settled.png),
      blank: input.isBlank ? input.isBlank(settled.png) : null,
      renderMs,
      captureMs: elapsedMs(clock, started),
    };
  } catch (error) {
    return failed(errorMessage(error), renderMs ?? elapsedMs(clock, started));
  }
}

interface Settled {
  readonly png: Uint8Array;
  readonly attempts: number;
  readonly stable: boolean;
}

async function settle(input: CaptureStoriesInput): Promise<Settled> {
  const { driver, options, sleep } = input;
  let settleMs = options.settleMs;
  let last: Settled | undefined;
  for (let attempt = 1; attempt <= Math.max(1, options.maxAttempts); attempt += 1) {
    await sleep(settleMs);
    const first = await driver.screenshot();
    await sleep(options.stabilityGapMs);
    const second = await driver.screenshot();
    last = { png: first, attempts: attempt, stable: isSame(input, first, second) };
    if (last.stable) return last;
    settleMs *= 2;
  }
  if (last === undefined) throw new Error('no capture attempt ran');
  return last;
}

/** Equal bytes are equal images; only differing bytes pay for a pixel comparison. */
function isSame(input: CaptureStoriesInput, first: Uint8Array, second: Uint8Array): boolean {
  if (input.hash(first) === input.hash(second)) return true;
  return input.compareImages(first, second).ratio === 0;
}

function emptyResult(story: StoryIndexEntry): CaptureResult {
  return {
    id: story.id,
    title: story.title,
    name: story.name,
    png: null,
    hash: null,
    width: 0,
    height: 0,
    renderMs: 0,
    captureMs: 0,
    attempts: 0,
    stable: false,
    blank: null,
    error: null,
  };
}

function elapsedMs(clock: Clock, since: Date): number {
  return clock.now().getTime() - since.getTime();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
