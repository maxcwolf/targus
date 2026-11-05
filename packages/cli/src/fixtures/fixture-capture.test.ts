import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadCapture } from '../run/load-capture.js';
import { fixtureCaptureReport, writeFixtureCapture } from './fixture-capture.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'targus-fixture-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('fixture capture', () => {
  it('has two solid stories and one gradient, each with a distinct hash', () => {
    const { stories } = fixtureCaptureReport();

    expect(stories.map((story) => [story.id, story.blank])).toEqual([
      ['fixture-solid--red', true],
      ['fixture-solid--blue', true],
      ['fixture-gradient--default', false],
    ]);
    expect(new Set(stories.map((story) => story.hash)).size).toBe(3);
    expect(stories.every((story) => story.width === 24 && story.height === 48)).toBe(true);
  });

  it('is deterministic', () => {
    expect(fixtureCaptureReport()).toEqual(fixtureCaptureReport());
  });

  it('writes a valid capture directory that loads back unchanged', async () => {
    const manifest = await writeFixtureCapture(dir);

    expect((await readdir(dir)).sort()).toEqual([
      'fixture-gradient--default.png',
      'fixture-solid--blue.png',
      'fixture-solid--red.png',
      'manifest.json',
    ]);
    expect(manifest.summary).toMatchObject({ storyCount: 3, captured: 3, failed: 0 });
    expect(manifest.summary.blank).toEqual(['fixture-solid--red', 'fixture-solid--blue']);
    expect(await loadCapture(dir)).toEqual(fixtureCaptureReport());
  });
});
