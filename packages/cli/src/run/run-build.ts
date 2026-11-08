import {
  CreateBuildRequest,
  SnapshotState,
  type Appearance,
  TargusError,
  type BaselineEntry,
  type Clock,
  type CreateBuildResponse,
  type IdGenerator,
  type StoryResult,
  type SubmitResultsResponse,
} from '@targus/core';
import { z } from 'zod';

import type { CaptureReport } from '../capture/capture-stories.ts';
import type { CapturePlatform } from '../capture/manifest.ts';
import type { CiContext } from './ci-context.ts';
import {
  defaultVariant,
  errorResult,
  isCaptured,
  judgeStory,
  type CapturedStory,
  type DiffImage,
  type StoryJudge,
} from './story-result.ts';
import type { TargusApi } from './targus-api.ts';

/** The server keeps at most this many first-parent ancestors (ADR 0004). */
export const maxAncestors = 100;

export interface RunGitInfo {
  readonly sha: string;
  readonly mergeBaseSha: string | null;
  readonly ancestors: readonly string[];
}

/** The threshold is not an input: the server sends it with the new build (ADR 0028). */
export interface RunBuildInput extends Omit<StoryJudge, 'api' | 'threshold'> {
  readonly report: CaptureReport;
  readonly git: RunGitInfo;
  readonly ci: CiContext;
  readonly device: string;
  /** What the capture's manifest records; null for a capture that predates it (ADR 0035). */
  readonly appearance: Appearance | null;
  /** The platform the capture is for (ADR 0036); `ios` when unset. */
  readonly platform?: CapturePlatform;
  /** Device pixels per CSS pixel of a web capture; null when unknown. */
  readonly pixelRatio?: number | null;
  readonly api: TargusApi;
  readonly clock: Clock;
  /** Gives the run its idempotency key, so a retried `POST /api/builds` opens one build. */
  readonly ids: IdGenerator;
  /** The `--filter` this run captured with, if any; only used to explain an empty capture. */
  readonly filter?: string;
}

export type StateCounts = Record<SnapshotState, number>;

export interface RunBuildOutput {
  readonly build: CreateBuildResponse['build'];
  readonly response: SubmitResultsResponse;
  readonly results: readonly StoryResult[];
  /**
   * Per-state counts; `removed` counts baseline stories this capture did not have, except the
   * ones `parameters.targus.skip` left out.
   */
  readonly counts: StateCounts;
  /** Stories left out by `parameters.targus.skip`: not submitted, not counted as removed. */
  readonly skipped: readonly string[];
  /** Every hash uploaded: missing captures first, then diff images. */
  readonly uploaded: readonly string[];
}

/**
 * The `POST /api/builds` body. Errored stories have no image, so they are not snapshots. Each
 * call takes a new idempotency key: the client resends this body as it is, so every attempt of
 * one run names the same build (ADR 0027).
 */
export function createBuildRequest(input: RunBuildInput): CreateBuildRequest {
  const { branch, prNumber, trigger } = input.ci;
  if (branch === null) {
    throw new TargusError('bad_request', 'cannot tell the branch: pass --branch');
  }
  const parsed = CreateBuildRequest.safeParse({
    sha: input.git.sha,
    branch,
    prNumber,
    mergeBaseSha: input.git.mergeBaseSha,
    ancestors: input.git.ancestors.slice(0, maxAncestors),
    trigger,
    device: input.device,
    appearance: input.appearance,
    platform: input.platform ?? 'ios',
    pixelRatio: input.pixelRatio ?? null,
    snapshots: input.report.stories.filter(isCaptured).map((story) => ({
      storyId: story.id,
      variant: defaultVariant,
      imageHash: story.hash,
      width: story.width,
      height: story.height,
    })),
    idempotencyKey: input.ids.next(),
  });
  if (!parsed.success) {
    throw new TargusError('bad_request', `invalid build:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

function baselineKey(storyId: string, variant: string): string {
  return `${storyId}\u0000${variant}`;
}

export function countStates(results: readonly StoryResult[], removed: number): StateCounts {
  const counts = Object.fromEntries(
    SnapshotState.options.map((state) => [state, 0]),
  ) as StateCounts;
  for (const { state } of results) counts[state] += 1;
  counts.removed += removed;
  return counts;
}

interface Judged {
  readonly results: StoryResult[];
  readonly diffs: DiffImage[];
}

async function judgeAll(input: RunBuildInput, created: CreateBuildResponse): Promise<Judged> {
  const { baselines, threshold } = created;
  const judge: StoryJudge = { ...input, threshold };
  const byKey = new Map(
    baselines.map((entry) => [baselineKey(entry.storyId, entry.variant), entry]),
  );
  const judged: Judged = { results: [], diffs: [] };
  for (const story of input.report.stories) {
    const baseline = byKey.get(baselineKey(story.id, defaultVariant));
    if (!isCaptured(story)) {
      judged.results.push(errorResult(story, baseline));
      continue;
    }
    const { result, diff } = await judgeStory(story, baseline, judge);
    judged.results.push(result);
    if (diff !== null) judged.diffs.push(diff);
  }
  return judged;
}

/** Upload what the server lacks plus every diff image, each hash once. */
async function uploadImages(
  api: TargusApi,
  captured: readonly CapturedStory[],
  missing: readonly string[],
  diffs: readonly DiffImage[],
): Promise<string[]> {
  const pngByHash = new Map(captured.map((story) => [story.hash, story.png]));
  const queue: DiffImage[] = missing.map((hash) => {
    const png = pngByHash.get(hash);
    if (png === undefined) {
      throw new TargusError(
        'internal',
        `the server asked for image ${hash}, which was not captured`,
      );
    }
    return { hash, png };
  });
  const uploaded = new Set<string>();
  for (const { hash, png } of [...queue, ...diffs]) {
    if (uploaded.has(hash)) continue;
    await api.uploadImage(hash, png);
    uploaded.add(hash);
  }
  return [...uploaded];
}

function removedCount(input: RunBuildInput, baselines: readonly BaselineEntry[]): number {
  const ids = new Set([...input.report.stories.map((story) => story.id), ...input.report.skipped]);
  return baselines.filter((entry) => !ids.has(entry.storyId)).length;
}

const indexHint =
  'check the `stories` glob in .rnstorybook/main and that the app was built with Storybook and ' +
  'its regenerated storybook.requires';

/** Why a capture with no stories and no skips is empty, as far as the CLI can tell. */
function emptyCaptureMessage(filter: string | undefined): string {
  if (filter !== undefined) {
    return (
      `no story matched --filter ${JSON.stringify(filter)}, or the story index had none, so ` +
      `there is nothing to compare: loosen --filter, or ${indexHint}`
    );
  }
  return (
    `the capture had no stories, so there is nothing to compare: ${indexHint}, ` +
    'or loosen --filter if the capture used one'
  );
}

/**
 * Refuse a capture with no stories before a build is opened. Submitting one would mark every
 * baseline story `removed`, which needs no review, so the check would pass and, on the default
 * branch, the empty build would become the next baseline (ADR 0022). The server refuses it too.
 * The report does not record the index size, so an empty index and a `--filter` that matched
 * nothing read the same; the message names both when a filter was given.
 */
function requireStories(report: CaptureReport, filter: string | undefined): void {
  if (report.stories.length > 0) return;
  const skipped = report.skipped.length;
  if (skipped > 0) {
    throw new TargusError(
      'bad_request',
      `${skipped === 1 ? 'the only story is' : `all ${skipped} stories are`} skipped by ` +
        '`parameters.targus.skip`, so there is nothing to compare: capture at least one story',
    );
  }
  throw new TargusError('bad_request', emptyCaptureMessage(filter));
}

/**
 * The server half of `targus run` (plan.md section 4): refuse an empty capture, open a build,
 * judge every story against its baseline locally (ADR 0003) with the threshold the server
 * returned (ADR 0028), upload missing captures and diff images, then submit the results with
 * that threshold, each naming the baseline it was diffed against (ADR 0032). Every effect goes
 * through `api`, so this is tested against an in-memory fake.
 */
export async function runBuild(input: RunBuildInput): Promise<RunBuildOutput> {
  requireStories(input.report, input.filter);
  const started = input.clock.now();
  const created = await input.api.createBuild(createBuildRequest(input));
  const { results, diffs } = await judgeAll(input, created);
  const captured = input.report.stories.filter(isCaptured);
  const uploaded = await uploadImages(input.api, captured, created.missingImageHashes, diffs);
  const elapsedMs = input.clock.now().getTime() - started.getTime();
  const durationMs = Math.max(0, Math.round(input.report.durationMs + elapsedMs));
  const response = await input.api.submitResults(created.build.id, {
    results,
    durationMs,
    threshold: created.threshold,
  });
  return {
    build: created.build,
    response,
    results,
    counts: countStates(results, removedCount(input, created.baselines)),
    skipped: input.report.skipped,
    uploaded,
  };
}
