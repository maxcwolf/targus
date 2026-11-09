import type { CompareImages } from '../capture/capture-stories.ts';
import { variantLabel } from '../capture/variant.ts';
import type { CaptureManifest, StoryRecord } from '../capture/manifest.ts';

/**
 * A story present in both captures, with its changed-pixel ratio against the baseline. Every
 * `id` in a comparison is the story id, or `id@mode` for a mode's variant.
 */
export interface ComparedStory {
  readonly id: string;
  readonly ratio: number;
  readonly baselineFile: string;
  readonly currentFile: string;
}

export interface ChangedStory extends ComparedStory {
  /** The pixelmatch diff image, or `null` when the comparer made none. */
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
  const baselineByLabel = new Map(input.baseline.stories.map((story) => [labelOf(story), story]));
  const currentLabels = new Set(input.current.stories.map(labelOf));
  // A story the current capture skipped (parameters.targus.skip) is absent on purpose.
  const skipped = new Set(input.current.summary.skipped);
  const buckets: Buckets = { changed: [], new: [], unchanged: [], unstable: [], errored: [] };
  for (const story of input.current.stories) {
    await classify(input, buckets, story, baselineByLabel.get(labelOf(story)));
  }
  const removed = input.baseline.stories
    .filter((story) => !skipped.has(story.id) && !currentLabels.has(labelOf(story)))
    .map((story) => ({ id: labelOf(story) }));
  return { threshold: input.threshold, ...buckets, removed };
}

function labelOf(story: StoryRecord): string {
  return variantLabel(story.id, story.variant);
}

async function classify(
  input: CompareCapturesInput,
  buckets: Buckets,
  current: StoryRecord,
  baseline: StoryRecord | undefined,
): Promise<void> {
  if (current.file === null) {
    buckets.errored.push({ id: labelOf(current), error: current.error ?? 'no capture' });
    return;
  }
  if (baseline === undefined || baseline.file === null) {
    buckets.new.push({ id: labelOf(current) });
    return;
  }
  const files = { id: labelOf(current), baselineFile: baseline.file, currentFile: current.file };
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
