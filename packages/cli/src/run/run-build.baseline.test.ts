import { createFakeClock, createFakeIdGenerator, isBlankPng } from '@targus/core';
import { describe, expect, it } from 'vitest';

import type { CaptureResult } from '../capture/capture-stories.ts';
import { compareWithCore } from '../capture/compare-images.ts';
import { sha256Hex } from '../capture/png.ts';
import { encodeSolidPng } from '../capture/solid-png.fake.ts';
import { runBuild, type RunBuildInput } from './run-build.ts';
import { createFakeTargusApi, type FakeTargusApi } from './targus-api.fake.ts';

// Every result names the baseline `POST /api/builds` offered for its story, the one its diff was
// measured against, so the server can tell when that baseline moved before the submit (ADR 0032).

const white = encodeSolidPng(10, 10, [255, 255, 255, 255]);
const black = encodeSolidPng(10, 10, [0, 0, 0, 255]);
const grey = encodeSolidPng(10, 10, [128, 128, 128, 255]);

function story(id: string, png: Uint8Array | null, error: string | null = null): CaptureResult {
  return {
    id,
    variant: 'default',
    title: 'T',
    name: id,
    png,
    hash: png === null ? null : sha256Hex(png),
    width: png === null ? 0 : 10,
    height: png === null ? 0 : 10,
    renderMs: 1,
    captureMs: 1,
    attempts: 1,
    stable: true,
    blank: false,
    error,
  };
}

function input(api: FakeTargusApi, stories: CaptureResult[]): RunBuildInput {
  return {
    report: { stories, skipped: [], startedAt: '2026-11-07T10:00:00.000Z', durationMs: 1 },
    git: { sha: 'a'.repeat(40), mergeBaseSha: null, ancestors: [] },
    ci: { branch: 'main', prNumber: null, trigger: 'main' },
    device: 'iPhone 16',
    appearance: 'light',
    api,
    clock: createFakeClock(),
    ids: createFakeIdGenerator('run'),
    compareImages: compareWithCore,
    hash: sha256Hex,
    isBlank: isBlankPng,
  };
}

async function submitted(api: FakeTargusApi, stories: CaptureResult[]) {
  await runBuild(input(api, stories));
  const results = api.callsOf('submitResults')[0]?.request.results ?? [];
  return new Map(results.map((result) => [result.storyId, result]));
}

describe('runBuild pins the baseline of each result', () => {
  it('names the offered baseline for an unchanged, a changed and an errored story', async () => {
    const api = createFakeTargusApi({ baselines: { same: white, diff: white, broken: white } });

    const byId = await submitted(api, [
      story('same', white),
      story('diff', black),
      story('broken', null, 'render threw'),
    ]);

    expect(byId.get('same')).toMatchObject({ state: 'unchanged', baselineHash: sha256Hex(white) });
    expect(byId.get('diff')).toMatchObject({ state: 'changed', baselineHash: sha256Hex(white) });
    expect(byId.get('broken')).toMatchObject({ state: 'error', baselineHash: sha256Hex(white) });
  });

  it('sends null for a story that was offered no baseline', async () => {
    const api = createFakeTargusApi({ baselines: { other: white } });

    const byId = await submitted(api, [story('fresh', black)]);

    expect(byId.get('fresh')).toMatchObject({ state: 'new', baselineHash: null, diffRatio: null });
  });

  it('pins the baseline it was offered, not one the server moved to before the submit', async () => {
    // The baseline build is reviewed while the run is open: any later answer of the server
    // names `grey`, but the CLI diffed against `white` and must say so.
    const api = createFakeTargusApi({ baselines: { s: white }, stored: [grey] });
    const offer = api.createBuild.bind(api);
    let opened = 0;
    const racing: FakeTargusApi = {
      ...api,
      createBuild: async (request) => {
        const response = await offer(request);
        opened += 1;
        if (opened === 1) return response;
        return {
          ...response,
          baselines: [{ storyId: 's', variant: 'default', imageHash: sha256Hex(grey) }],
        };
      },
    };

    const byId = await submitted(racing, [story('s', white)]);

    expect(opened).toBe(1);
    expect(byId.get('s')).toMatchObject({
      state: 'unchanged',
      baselineHash: sha256Hex(white),
      diffRatio: 0,
    });
  });
});

describe('runBuild with mode variants', () => {
  it('judges each variant against its own baseline and counts a dropped mode removed', async () => {
    const api = createFakeTargusApi({
      baselines: { 'a@light': white, 'a@dark': white, 'a@print': white },
    });
    const light = { ...story('a', white), variant: 'light' };
    const dark = { ...story('a', black), variant: 'dark' };

    const output = await runBuild(input(api, [light, dark]));

    expect(output.results.map((result) => [result.variant, result.state])).toEqual([
      ['light', 'unchanged'],
      ['dark', 'changed'],
    ]);
    const snapshots = api.callsOf('createBuild')[0]?.request.snapshots ?? [];
    expect(snapshots.map((snapshot) => snapshot.variant)).toEqual(['light', 'dark']);
    expect(output.counts.removed).toBe(1);
  });
});
