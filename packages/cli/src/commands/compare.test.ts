import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256Hex } from '../capture/png.ts';
import { encodeSolidPng } from '../capture/solid-png.fake.ts';
import { defaultCompareDeps, runCompare } from './compare.ts';

const white = [255, 255, 255, 255] as const;
const red = [255, 0, 0, 255] as const;

let dir: string;

async function writeCapture(name: string, pngs: Record<string, Uint8Array>): Promise<string> {
  const capture = path.join(dir, name);
  await mkdir(capture, { recursive: true });
  const stories = [];
  for (const [id, png] of Object.entries(pngs)) {
    await writeFile(path.join(capture, `${id}.png`), png);
    stories.push({
      id,
      title: 'T',
      name: id,
      file: `${id}.png`,
      hash: sha256Hex(png),
      width: 4,
      height: 4,
      renderMs: 1,
      captureMs: 1,
      attempts: 1,
      stable: true,
      blank: false,
      error: null,
    });
  }
  const summary = {
    device: { udid: 'SIM', appearance: 'light' },
    app: { bundleId: 'co.example', path: null },
    settleMs: 300,
    stabilityGapMs: 150,
    storyCount: stories.length,
    captured: stories.length,
    failed: 0,
    unstable: [],
    blank: [],
    duplicateHashes: [],
    startedAt: '2026-11-04T10:00:00.000Z',
    durationMs: 1,
    perStoryMs: null,
  };
  await writeFile(
    path.join(capture, 'manifest.json'),
    JSON.stringify({ version: 1, summary, stories }),
  );
  return capture;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'targus-compare-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('runCompare', () => {
  it('writes report.json, report.html and a diff PNG per changed story', async () => {
    const baseline = await writeCapture('baseline', {
      'same--story': encodeSolidPng(4, 4, white),
      'changed--story': encodeSolidPng(4, 4, white),
      'gone--story': encodeSolidPng(4, 4, white),
    });
    const current = await writeCapture('current', {
      'same--story': encodeSolidPng(4, 4, white),
      'changed--story': encodeSolidPng(4, 4, white, { x: 0, y: 0, color: red }),
      'new--story': encodeSolidPng(4, 4, white),
    });
    const out = path.join(dir, 'report');
    const lines: string[] = [];

    await runCompare(
      { current, baseline, out, threshold: 0.001 },
      { ...defaultCompareDeps, log: (line) => lines.push(line) },
    );

    expect((await readdir(out)).sort()).toEqual([
      'changed--story.diff.png',
      'report.html',
      'report.json',
    ]);
    const report = JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8')) as unknown;
    expect(report).toEqual({
      threshold: 0.001,
      counts: { changed: 1, new: 1, removed: 1, unchanged: 1, unstable: 0, errored: 0 },
      changed: [
        {
          id: 'changed--story',
          ratio: 0.0625,
          baseline: '../baseline/changed--story.png',
          current: '../current/changed--story.png',
          diff: 'changed--story.diff.png',
        },
      ],
      new: [{ id: 'new--story' }],
      removed: [{ id: 'gone--story' }],
      unchanged: [{ id: 'same--story', ratio: 0 }],
      unstable: [],
      errored: [],
    });
    const html = await readFile(path.join(out, 'report.html'), 'utf8');
    expect(html).toContain('src="../baseline/changed--story.png"');
    expect(html).toContain('src="changed--story.diff.png"');
    expect(html).toContain('6.250% changed');
    expect(html).not.toMatch(/https?:\/\//);
    expect(lines[0]).toBe('1 changed, 1 new, 1 removed, 1 unchanged, 0 unstable, 0 errored');
  });
});

describe('runCompare with a size change', () => {
  it('diffs the images on a padded canvas and writes the diff image', async () => {
    const baseline = await writeCapture('baseline', { s: encodeSolidPng(4, 4, white) });
    const current = await writeCapture('current', { s: encodeSolidPng(4, 5, white) });
    const out = path.join(dir, 'report');

    const comparison = await runCompare(
      { current, baseline, out, threshold: 0.001 },
      { ...defaultCompareDeps, log: () => undefined },
    );

    // The added row of 4 pixels is the only change on the 4 x 5 canvas.
    expect(comparison.changed).toMatchObject([{ id: 's', ratio: 0.2 }]);
    expect(comparison.changed[0]?.diffPng).toBeInstanceOf(Uint8Array);
    expect(await readdir(out)).toContain('s.diff.png');
    const html = await readFile(path.join(out, 'report.html'), 'utf8');
    expect(html).toContain('src="s.diff.png"');
    expect(html).toContain('20.000% changed');
  });
});

describe('runCompare without a diff image', () => {
  it('reports a changed story with no diff image when the comparer makes none', async () => {
    const baseline = await writeCapture('baseline', { s: encodeSolidPng(4, 4, white) });
    const current = await writeCapture('current', { s: encodeSolidPng(4, 4, red) });
    const out = path.join(dir, 'report');

    await runCompare(
      { current, baseline, out, threshold: 0.001 },
      { compareImages: () => ({ ratio: 1, diffPng: null }), log: () => undefined },
    );

    expect(await readdir(out)).not.toContain('s.diff.png');
    const report = JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8')) as unknown;
    expect(report).toMatchObject({ changed: [{ id: 's', diff: null }] });
    expect(await readFile(path.join(out, 'report.html'), 'utf8')).toContain('no diff image');
  });
});
