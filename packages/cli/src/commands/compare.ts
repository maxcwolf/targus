import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { CompareImages } from '../capture/capture-stories.js';
import { compareWithCore } from '../capture/compare-images.js';
import { readCaptureManifest } from '../capture/manifest.js';
import { compareCaptures, type CaptureComparison } from '../compare/compare-captures.js';
import { comparisonHtml, comparisonJson, type ReportPaths } from '../compare/compare-report.js';

export interface CompareCommandOptions {
  readonly current: string;
  readonly baseline: string;
  readonly out: string;
  /** Changed-pixel ratio above which a story is `changed`. Default 0.001 (plan.md 7). */
  readonly threshold: number;
}

export interface CompareCommandDeps {
  readonly compareImages: CompareImages;
  readonly log: (line: string) => void;
}

export const defaultCompareDeps: CompareCommandDeps = {
  compareImages: compareWithCore,
  log: (line) => {
    process.stdout.write(`${line}\n`);
  },
};

export function diffFileName(storyId: string): string {
  return `${storyId}.diff.png`;
}

/**
 * `targus compare`: diff a capture against a baseline capture and write `report.json`,
 * `report.html` and `<storyId>.diff.png` for changed stories into `out`. Informational only:
 * it never fails on changes.
 */
export async function runCompare(
  options: CompareCommandOptions,
  deps: CompareCommandDeps = defaultCompareDeps,
): Promise<CaptureComparison> {
  const dirs = {
    current: path.resolve(options.current),
    baseline: path.resolve(options.baseline),
    out: path.resolve(options.out),
  };
  const comparison = await compareCaptures({
    current: await readCaptureManifest(dirs.current),
    baseline: await readCaptureManifest(dirs.baseline),
    threshold: options.threshold,
    loadPng: async (side, file) => new Uint8Array(await readFile(path.join(dirs[side], file))),
    compareImages: deps.compareImages,
  });
  await mkdir(dirs.out, { recursive: true });
  for (const story of comparison.changed) {
    if (story.diffPng !== null) {
      await writeFile(path.join(dirs.out, diffFileName(story.id)), story.diffPng);
    }
  }
  const relative = (dir: string) => (file: string) =>
    path.relative(dirs.out, path.join(dir, file)).split(path.sep).join('/');
  const paths: ReportPaths = {
    baseline: relative(dirs.baseline),
    current: relative(dirs.current),
    diff: (id) => diffFileName(id),
  };
  const json = `${JSON.stringify(comparisonJson(comparison, paths), null, 2)}\n`;
  await writeFile(path.join(dirs.out, 'report.json'), json);
  await writeFile(path.join(dirs.out, 'report.html'), comparisonHtml(comparison, paths));
  deps.log(
    `${comparison.changed.length} changed, ${comparison.new.length} new, ` +
      `${comparison.removed.length} removed, ${comparison.unchanged.length} unchanged, ` +
      `${comparison.unstable.length} unstable, ${comparison.errored.length} errored`,
  );
  deps.log(`report: ${path.join(dirs.out, 'report.html')}`);
  return comparison;
}
