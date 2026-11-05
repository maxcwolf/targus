import { compareSnapshot, type BaselineEntry, type StoryResult } from '@targus/core';

import type { CaptureResult, CompareImages } from '../capture/capture-stories.js';
import type { TargusApi } from './targus-api.js';

/** Every story is captured once per build, so it is always the default variant (plan.md 6). */
export const defaultVariant = 'default';

/** What judging one story needs besides the story and its baseline. */
export interface StoryJudge {
  readonly api: Pick<TargusApi, 'getImage'>;
  readonly compareImages: CompareImages;
  readonly hash: (bytes: Uint8Array) => string;
  readonly isBlank: (png: Uint8Array) => boolean;
  /** Changed-pixel ratio above which a stable story is `changed`. */
  readonly threshold: number;
}

/** A diff image to upload, named by its sha256. */
export interface DiffImage {
  readonly hash: string;
  readonly png: Uint8Array;
}

export interface StoryOutcome {
  readonly result: StoryResult;
  readonly diff: DiffImage | null;
}

/** A capture that produced an image; anything else is an `error` result. */
export interface CapturedStory extends CaptureResult {
  readonly png: Uint8Array;
  readonly hash: string;
}

export function isCaptured(story: CaptureResult): story is CapturedStory {
  return story.error === null && story.png !== null && story.hash !== null;
}

/** A story whose render errored: no image, so nothing to diff (ADR 0004, rule 6). */
export function errorResult(story: CaptureResult): StoryResult {
  return {
    storyId: story.id,
    variant: defaultVariant,
    state: 'error',
    imageHash: null,
    width: null,
    height: null,
    diffHash: null,
    diffRatio: null,
    error: story.error ?? 'the story produced no capture',
    blank: false,
  };
}

interface Diffed {
  readonly ratio: number | null;
  readonly diffPng: Uint8Array | null;
}

/** Download the baseline and diff it, but only when the hashes differ (ADR 0003). */
async function diffAgainst(
  story: CapturedStory,
  baseline: BaselineEntry | undefined,
  judge: StoryJudge,
): Promise<Diffed> {
  if (baseline === undefined) return { ratio: null, diffPng: null };
  if (baseline.imageHash === story.hash) return { ratio: 0, diffPng: null };
  const baselinePng = await judge.api.getImage(baseline.imageHash);
  return judge.compareImages(baselinePng, story.png);
}

/**
 * Classify a captured story against its baseline with core's `compareSnapshot` (so the CLI and
 * the server agree on `new`, `unchanged`, `unstable` and `changed`). Approvals are the server's
 * business, so none are passed here. A diff image is kept for `changed` and `unstable` stories,
 * which the review UI shows; an under-threshold diff is not worth storing.
 */
export async function judgeStory(
  story: CapturedStory,
  baseline: BaselineEntry | undefined,
  judge: StoryJudge,
): Promise<StoryOutcome> {
  const { ratio, diffPng } = await diffAgainst(story, baseline, judge);
  const { state } = compareSnapshot({
    current: { imageHash: story.hash, unstable: !story.stable, error: null },
    baseline: baseline ?? null,
    diffRatio: ratio,
    threshold: judge.threshold,
    approvals: [],
  });
  const keepDiff = diffPng !== null && (state === 'changed' || state === 'unstable');
  const diff = keepDiff ? { hash: judge.hash(diffPng), png: diffPng } : null;
  return {
    result: {
      storyId: story.id,
      variant: defaultVariant,
      state,
      imageHash: story.hash,
      width: story.width,
      height: story.height,
      diffHash: diff?.hash ?? null,
      diffRatio: ratio,
      error: null,
      blank: story.blank ?? judge.isBlank(story.png),
    },
    diff,
  };
}
