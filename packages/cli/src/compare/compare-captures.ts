import type { CompareImages } from '../capture/capture-stories.js';
import type { CaptureManifest, StoryRecord } from '../capture/manifest.js';

/** A story present in both captures, with its changed-pixel ratio against the baseline. */
export interface ComparedStory {
  readonly id: string;
  readonly ratio: number;
  readonly baselineFile: string;
  readonly currentFile: string;
}

export interface ChangedStory extends ComparedStory {
  /** The pixelmatch diff image, or `null` when the sizes differ. */
  readonly diffPng: Uint8Array | null;
}

export interface StoryRef {
  readonly id: string;
}

export interface ErroredStory extends StoryRef {
  readonly error: string;
}

/** The outcome of `targus compare`, before it is written to disk. */
export interface CaptureComparison {
  readonly threshold: number;
  readonly changed: readonly ChangedStory[];
  readonly new: readonly StoryRef[];
  readonly removed: readonly StoryRef[];
  readonly unchanged: readonly ComparedStory[];
  /** Diffed but not judged: the current capture never settled (plan.md 5.1). */
  readonly unstable: readonly ComparedStory[];
  /** The story errored in the current capture, so there is nothing to diff. */
  readonly errored: readonly ErroredStory[];
}

export interface CompareCapturesInput {
  readonly current: CaptureManifest;
  readonly baseline: CaptureManifest;
  /** Changed-pixel ratio above which a story counts as changed (plan.md 7: 0.1%). */
  readonly threshold: number;
  /** Load the PNG a manifest record points to; `side` says which capture it belongs to. */
  readonly loadPng: (side: 'current' | 'baseline', file: string) => Promise<Uint8Array>;
  readonly compareImages: CompareImages;
}

interface Buckets {
  changed: ChangedStory[];
  new: StoryRef[];
  unchanged: ComparedStory[];
  unstable: ComparedStory[];
  errored: ErroredStory[];
}

/** Sort every current story into changed / new / unchanged / unstable / errored, plus removed. */
export async function compareCaptures(input: CompareCapturesInput): Promise<CaptureComparison> {
  const baselineById = new Map(input.baseline.stories.map((story) => [story.id, story]));
  const currentIds = new Set(input.current.stories.map((story) => story.id));
  const buckets: Buckets = { changed: [], new: [], unchanged: [], unstable: [], errored: [] };
  for (const story of input.current.stories) {
    await classify(input, buckets, story, baselineById.get(story.id));
  }
  const removed = input.baseline.stories
    .filter((story) => !currentIds.has(story.id))
    .map(({ id }) => ({ id }));
  return { threshold: input.threshold, ...buckets, removed };
}

async function classify(
  input: CompareCapturesInput,
  buckets: Buckets,
  current: StoryRecord,
  baseline: StoryRecord | undefined,
): Promise<void> {
  if (current.file === null) {
    buckets.errored.push({ id: current.id, error: current.error ?? 'no capture' });
    return;
  }
  if (baseline === undefined || baseline.file === null) {
    buckets.new.push({ id: current.id });
    return;
  }
  const files = { id: current.id, baselineFile: baseline.file, currentFile: current.file };
  const comparison =
    current.hash !== null && current.hash === baseline.hash
      ? { ratio: 0, diffPng: null }
      : input.compareImages(
          await input.loadPng('baseline', baseline.file),
          await input.loadPng('current', current.file),
        );
  const compared = { ...files, ratio: comparison.ratio };
  if (!current.stable) buckets.unstable.push(compared);
  else if (comparison.ratio > input.threshold) {
    buckets.changed.push({ ...compared, diffPng: comparison.diffPng });
  } else buckets.unchanged.push(compared);
}
