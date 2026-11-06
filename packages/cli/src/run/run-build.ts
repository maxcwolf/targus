import {
  CreateBuildRequest,
  SnapshotState,
  TargusError,
  type BaselineEntry,
  type Clock,
  type CreateBuildResponse,
  type StoryResult,
  type SubmitResultsResponse,
} from '@targus/core';
import { z } from 'zod';

import type { CaptureReport } from '../capture/capture-stories.ts';
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

export interface RunBuildInput extends Omit<StoryJudge, 'api'> {
  readonly report: CaptureReport;
  readonly git: RunGitInfo;
  readonly ci: CiContext;
  readonly device: string;
  readonly api: TargusApi;
  readonly clock: Clock;
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

/** The `POST /api/builds` body. Errored stories have no image, so they are not snapshots. */
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
    snapshots: input.report.stories.filter(isCaptured).map((story) => ({
      storyId: story.id,
      variant: defaultVariant,
      imageHash: story.hash,
      width: story.width,
      height: story.height,
    })),
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

async function judgeAll(
  input: RunBuildInput,
  baselines: readonly BaselineEntry[],
): Promise<Judged> {
  const byKey = new Map(
    baselines.map((entry) => [baselineKey(entry.storyId, entry.variant), entry]),
  );
  const judged: Judged = { results: [], diffs: [] };
  for (const story of input.report.stories) {
    if (!isCaptured(story)) {
      judged.results.push(errorResult(story));
      continue;
    }
    const baseline = byKey.get(baselineKey(story.id, defaultVariant));
    const { result, diff } = await judgeStory(story, baseline, input);
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

/**
 * The server half of `targus run` (plan.md section 4): open a build, judge every story against
 * its baseline locally (ADR 0003), upload missing captures and diff images, then submit the
 * results. Every effect goes through `api`, so this is tested against an in-memory fake.
 */
export async function runBuild(input: RunBuildInput): Promise<RunBuildOutput> {
  const started = input.clock.now();
  const created = await input.api.createBuild(createBuildRequest(input));
  const { results, diffs } = await judgeAll(input, created.baselines);
  const captured = input.report.stories.filter(isCaptured);
  const uploaded = await uploadImages(input.api, captured, created.missingImageHashes, diffs);
  const elapsedMs = input.clock.now().getTime() - started.getTime();
  const durationMs = Math.max(0, Math.round(input.report.durationMs + elapsedMs));
  const response = await input.api.submitResults(created.build.id, { results, durationMs });
  return {
    build: created.build,
    response,
    results,
    counts: countStates(results, removedCount(input, created.baselines)),
    skipped: input.report.skipped,
    uploaded,
  };
}
