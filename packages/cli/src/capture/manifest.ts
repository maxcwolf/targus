import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { TargusError } from '@targus/core';
import { z } from 'zod';

import { summarizeIssues } from '../errors/zod-summary.js';
import type { CaptureReport, CaptureResult } from './capture-stories.js';

const Ms = z.number().int().nonnegative();

const StoryRecord = z.object({
  id: z.string(),
  title: z.string(),
  name: z.string(),
  /** PNG path relative to the manifest, or `null` when the story errored. */
  file: z.string().nullable(),
  hash: z.string().nullable(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  renderMs: Ms,
  captureMs: Ms,
  attempts: z.number().int().nonnegative(),
  stable: z.boolean(),
  blank: z.boolean().nullable(),
  error: z.string().nullable(),
});
export type StoryRecord = z.infer<typeof StoryRecord>;

const PerStoryMs = z.object({ mean: Ms, median: Ms, p90: Ms, max: Ms });
export type PerStoryMs = z.infer<typeof PerStoryMs>;

const Summary = z.object({
  device: z.object({ udid: z.string() }),
  app: z.object({ bundleId: z.string(), path: z.string().nullable() }),
  settleMs: Ms,
  stabilityGapMs: Ms,
  storyCount: z.number().int().nonnegative(),
  captured: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  unstable: z.array(z.string()),
  blank: z.array(z.string()),
  /** Groups of story ids whose captures are byte-identical (plan.md 5.1 capture hygiene). */
  duplicateHashes: z.array(z.array(z.string())),
  startedAt: z.iso.datetime(),
  durationMs: Ms,
  perStoryMs: PerStoryMs.nullable(),
});

/** `manifest.json` written by `targus capture`, read by `targus compare`. */
export const CaptureManifest = z.object({
  version: z.literal(1),
  summary: Summary,
  stories: z.array(StoryRecord),
});
export type CaptureManifest = z.infer<typeof CaptureManifest>;

export const manifestFileName = 'manifest.json';

/** Facts about the run that the capture loop itself does not know. */
export interface CaptureRunInfo {
  readonly udid: string;
  readonly bundleId: string;
  readonly appPath: string | null;
  readonly settleMs: number;
  readonly stabilityGapMs: number;
}

export function pngFileName(storyId: string): string {
  return `${storyId}.png`;
}

/** Mean, median, p90 and max of the capture times of the stories that produced a PNG. */
export function perStoryStats(times: readonly number[]): PerStoryMs | null {
  if (times.length === 0) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const at = (fraction: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
  return {
    mean: Math.round(sorted.reduce((sum, ms) => sum + ms, 0) / sorted.length),
    median: at(0.5),
    p90: at(0.9),
    max: at(1),
  };
}

function duplicateGroups(stories: readonly CaptureResult[]): string[][] {
  const byHash = new Map<string, string[]>();
  for (const { id, hash } of stories) {
    if (hash === null) continue;
    byHash.set(hash, [...(byHash.get(hash) ?? []), id]);
  }
  return [...byHash.values()].filter((ids) => ids.length > 1);
}

function toRecord(result: CaptureResult): StoryRecord {
  const { png, ...rest } = result;
  return { ...rest, file: png === null ? null : pngFileName(result.id) };
}

/** Build the manifest for a capture report. Pure; `writeCaptureOutput` does the I/O. */
export function buildManifest(report: CaptureReport, run: CaptureRunInfo): CaptureManifest {
  const captured = report.stories.filter((story) => story.png !== null);
  return {
    version: 1,
    summary: {
      device: { udid: run.udid },
      app: { bundleId: run.bundleId, path: run.appPath },
      settleMs: run.settleMs,
      stabilityGapMs: run.stabilityGapMs,
      storyCount: report.stories.length,
      captured: captured.length,
      failed: report.stories.filter((story) => story.error !== null).length,
      unstable: captured.filter((story) => !story.stable).map((story) => story.id),
      blank: captured.filter((story) => story.blank === true).map((story) => story.id),
      duplicateHashes: duplicateGroups(captured),
      startedAt: report.startedAt,
      durationMs: report.durationMs,
      perStoryMs: perStoryStats(captured.map((story) => story.captureMs)),
    },
    stories: report.stories.map(toRecord),
  };
}

/** Write `<storyId>.png` for every captured story plus `manifest.json` into `dir`. */
export async function writeCaptureOutput(
  dir: string,
  report: CaptureReport,
  run: CaptureRunInfo,
): Promise<CaptureManifest> {
  const manifest = buildManifest(report, run);
  await mkdir(dir, { recursive: true });
  for (const story of report.stories) {
    if (story.png !== null) await writeFile(path.join(dir, pngFileName(story.id)), story.png);
  }
  await writeFile(path.join(dir, manifestFileName), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function parseJson(text: string, file: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new TargusError('bad_request', `${file} is not valid JSON: is it a targus capture?`, {
      cause: error,
    });
  }
}

/** Read and validate `dir/manifest.json`; a bad one is a `bad_request` naming the file. */
export async function readCaptureManifest(dir: string): Promise<CaptureManifest> {
  const file = path.join(dir, manifestFileName);
  const text = await readFile(file, 'utf8');
  const parsed = CaptureManifest.safeParse(parseJson(text, file));
  if (!parsed.success) {
    const issues = summarizeIssues(parsed.error.issues);
    throw new TargusError('bad_request', `invalid ${manifestFileName} in ${dir}:\n${issues}`);
  }
  return parsed.data;
}
