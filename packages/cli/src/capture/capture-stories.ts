import {
  defaultContentSize,
  type CaptureMode,
  type Clock,
  type ContentSize,
  type DeviceDriver,
  type StoryCaptureParameters,
  type StoryIndexEntry,
  type StorybookChannel,
} from '@targus/core';

import { readPngSize } from './png.ts';
import { settle } from './settle.ts';
import { defaultVariant } from './variant.ts';

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
  /** `default`, or the name of the mode the story was captured in (web-plan.md step W5). */
  readonly variant: string;
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
  /** Ids of stories left out by `parameters.targus.skip`: not captured and not errors. */
  readonly skipped: readonly string[];
  readonly startedAt: string;
  readonly durationMs: number;
}

export interface CaptureProgress {
  readonly index: number;
  readonly total: number;
  /** For a skipped story, an empty result with `skipped` true. */
  readonly result: CaptureResult;
  readonly skipped: boolean;
}

export interface CaptureStoriesInput {
  readonly channel: StorybookChannel;
  /**
   * Takes the screenshots (ADR 0037). A driver that can also set the content size, a device's,
   * gets a story's `contentSize` modes captured (ADR 0042); a web page has no such setting.
   */
  readonly driver: Pick<DeviceDriver, 'screenshot'> & Partial<Pick<DeviceDriver, 'setContentSize'>>;
  /** Stories to capture; defaults to the index the app reports. */
  readonly stories?: readonly StoryIndexEntry[];
  readonly options: CaptureOptions;
  readonly clock: Clock;
  readonly sleep: (ms: number) => Promise<void>;
  readonly hash: (bytes: Uint8Array) => string;
  readonly compareImages: CompareImages;
  readonly isBlank?: (png: Uint8Array) => boolean;
  readonly onProgress?: (progress: CaptureProgress) => void;
  /** Stop after the story in flight, without reporting it, once this is aborted (ADR 0021). */
  readonly signal?: AbortSignal;
}

/** What an error result says for a story that threw an error with an empty message. */
export const noErrorMessage = 'the story threw an error with no message';

/**
 * A story's error as the server takes it: never empty, since one empty message would get the
 * whole results body refused. A story may throw `new Error()`, and an older decorator reports
 * its empty message as it is.
 */
export function storyErrorMessage(message: string): string {
  return message.trim() === '' ? noErrorMessage : message;
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
 * The capture loop proven by the capture spike (docs/capture-spike.md): select each story, wait for
 * the app to commit it, settle, take two screenshots `stabilityGapMs` apart and keep the first
 * if they match. On a mismatch retry with a doubled settle up to `maxAttempts`, then mark the story
 * unstable. Channel errors and timeouts are recorded per story and never thrown; only an aborted
 * `signal` ends the loop early.
 */
export async function captureStories(input: CaptureStoriesInput): Promise<CaptureReport> {
  const { channel, clock, options } = input;
  const startedAt = clock.now();
  const stories = selectStories(input.stories ?? (await channel.getIndex()), options);
  const results: CaptureResult[] = [];
  const skipped: string[] = [];
  for (const [index, story] of stories.entries()) {
    const outcome = await captureStory(input, story);
    input.signal?.throwIfAborted();
    if (outcome === 'skipped') {
      skipped.push(story.id);
      input.onProgress?.({
        index,
        total: stories.length,
        result: emptyResult(story),
        skipped: true,
      });
      continue;
    }
    results.push(...outcome);
    for (const result of outcome) {
      input.onProgress?.({ index, total: stories.length, result, skipped: false });
    }
  }
  return {
    stories: results,
    skipped,
    startedAt: startedAt.toISOString(),
    durationMs: elapsedMs(clock, startedAt),
  };
}

/** A mode that only asks for a content size: a device's, with nothing for a web page to apply. */
function isDeviceOnly(mode: CaptureMode): boolean {
  return (
    mode.contentSize !== undefined &&
    mode.viewport === null &&
    Object.keys(mode.globals).length === 0
  );
}

/**
 * The modes to capture a story in on a channel that applies them, or `null` for one default
 * capture. Device-only modes are left out; a story with no other mode keeps its default capture.
 */
function modesOf(
  input: CaptureStoriesInput,
  parameters: StoryCaptureParameters | undefined,
): readonly CaptureMode[] | null {
  const modes = parameters?.modes;
  if (input.channel.supportsModes !== true || modes === undefined) return null;
  const applicable = modes.filter((mode) => !isDeviceOnly(mode));
  return applicable.length === 0 && modes.length > 0 ? null : applicable;
}

/** A mode a device captures: one that asks for a content size. */
type SizedMode = CaptureMode & { readonly contentSize: ContentSize };

type SetContentSize = DeviceDriver['setContentSize'];

/**
 * The modes a device captures beside the default capture: those that set `contentSize`
 * (ADR 0042). A mode named `default` is left out, since that is the default capture's variant.
 */
function sizedModes(parameters: StoryCaptureParameters | undefined): readonly SizedMode[] {
  return (parameters?.modes ?? []).filter(
    (mode): mode is SizedMode => mode.contentSize !== undefined && mode.name !== defaultVariant,
  );
}

/**
 * Capture the story on screen once per sized mode: set the device's content size, let the app
 * lay out again, and screenshot, with no new selection. The size is put back to the default
 * afterwards, whatever happened, and the app is given the settle time to follow.
 */
async function captureSizedModes(
  input: CaptureStoriesInput,
  story: StoryIndexEntry,
  parameters: StoryCaptureParameters | undefined,
  setContentSize: SetContentSize,
): Promise<CaptureResult[]> {
  const results: CaptureResult[] = [];
  try {
    for (const mode of sizedModes(parameters)) {
      const at = selecting(input, story, mode);
      try {
        await setContentSize(mode.contentSize);
        results.push(await shoot(input, at, parameters, 0));
      } catch (error) {
        results.push(failedCapture(input, at, errorMessage(error), 0).result);
      }
    }
  } finally {
    await setContentSize(defaultContentSize);
    await input.sleep(input.options.settleMs);
  }
  return results;
}

/** The default capture, then one per sized mode when the driver can set the content size. */
async function captureOnDevice(
  input: CaptureStoriesInput,
  story: StoryIndexEntry,
  first: Captured,
): Promise<CaptureResult[]> {
  const setContentSize = input.driver.setContentSize?.bind(input.driver);
  const failed = first.result.error !== null;
  if (setContentSize === undefined || failed || sizedModes(first.parameters).length === 0) {
    return [first.result];
  }
  const sized = await captureSizedModes(input, story, first.parameters, setContentSize);
  return [first.result, ...sized];
}

/**
 * Capture one story, or `skipped` when its `parameters.targus.skip` is set. Its
 * `parameters.targus.delay` replaces `settleMs` as the wait before the first screenshot. A story
 * with modes, on a channel that supports them, is captured once per mode, each its own variant.
 * On a device it is captured once as `default`, then once per mode that sets a content size.
 */
async function captureStory(
  input: CaptureStoriesInput,
  story: StoryIndexEntry,
): Promise<CaptureResult[] | 'skipped'> {
  const first = await captureSelection(input, story, null);
  if (first === 'skipped') return 'skipped';
  const modes = modesOf(input, first.parameters);
  if (modes === null) return captureOnDevice(input, story, first);
  if (modes.length === 0) return 'skipped';
  const results: CaptureResult[] = [];
  for (const mode of modes) {
    const captured = await captureSelection(input, story, mode);
    if (captured !== 'skipped') results.push(captured.result);
  }
  return results;
}

interface Captured {
  readonly result: CaptureResult;
  readonly parameters?: StoryCaptureParameters;
}

/** Where one selection started, and the variant it captures. */
interface Selecting {
  readonly story: StoryIndexEntry;
  readonly variant: string;
  readonly started: Date;
}

function failedCapture(
  input: CaptureStoriesInput,
  at: Selecting,
  error: string,
  renderMs: number,
): Captured {
  const result: CaptureResult = {
    ...emptyResult(at.story),
    variant: at.variant,
    renderMs,
    captureMs: elapsedMs(input.clock, at.started),
    error: storyErrorMessage(error),
  };
  return { result };
}

/** Select without a mode argument when there is none, as channels before modes expect. */
const select = ({ channel, options }: CaptureStoriesInput, id: string, mode: CaptureMode | null) =>
  mode === null
    ? channel.selectStory(id, options.renderTimeoutMs)
    : channel.selectStory(id, options.renderTimeoutMs, mode);

/** Settle the selected story and screenshot it. */
async function shoot(
  input: CaptureStoriesInput,
  at: Selecting,
  parameters: StoryCaptureParameters | undefined,
  renderMs: number,
): Promise<CaptureResult> {
  const settled = await settle(input, parameters?.delay ?? input.options.settleMs);
  return {
    ...emptyResult(at.story),
    variant: at.variant,
    ...settled,
    ...readPngSize(settled.png),
    hash: input.hash(settled.png),
    blank: input.isBlank ? input.isBlank(settled.png) : null,
    renderMs,
    captureMs: elapsedMs(input.clock, at.started),
  };
}

function selecting(
  input: CaptureStoriesInput,
  story: StoryIndexEntry,
  mode: CaptureMode | null,
): Selecting {
  return { story, variant: mode?.name ?? defaultVariant, started: input.clock.now() };
}

/** Select the story (in `mode`, if any), then settle and screenshot it. */
async function captureSelection(
  input: CaptureStoriesInput,
  story: StoryIndexEntry,
  mode: CaptureMode | null,
): Promise<Captured | 'skipped'> {
  const at = selecting(input, story, mode);
  let renderMs: number | null = null;
  try {
    const selection = await select(input, story.id, mode);
    renderMs = elapsedMs(input.clock, at.started);
    if (selection.kind === 'error') return failedCapture(input, at, selection.message, renderMs);
    const { parameters } = selection;
    if (parameters?.skip === true) return 'skipped';
    const withParameters = parameters ? { parameters } : {};
    // The default selection only reads the modes; each mode is then captured on its own.
    if (mode === null && modesOf(input, parameters) !== null) {
      return { result: emptyResult(story), ...withParameters };
    }
    return { result: await shoot(input, at, parameters, renderMs), ...withParameters };
  } catch (error) {
    const ms = renderMs ?? elapsedMs(input.clock, at.started);
    return failedCapture(input, at, errorMessage(error), ms);
  }
}

function emptyResult(story: StoryIndexEntry): CaptureResult {
  return {
    id: story.id,
    variant: defaultVariant,
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
  if (!(error instanceof Error)) return String(error);
  return error.message.trim() === '' ? `${error.name} thrown with no message` : error.message;
}
