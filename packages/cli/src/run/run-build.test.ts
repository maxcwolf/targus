import {
  compareSnapshot,
  createFakeClock,
  createFakeIdGenerator,
  diffImages,
  isBlankPng,
  isTargusError,
} from '@targus/core';
import { describe, expect, it } from 'vitest';

import type { CaptureReport, CaptureResult } from '../capture/capture-stories.ts';
import { compareWithCore } from '../capture/compare-images.ts';
import { sha256Hex } from '../capture/png.ts';
import { encodeSolidPng, type Rgba } from '../capture/solid-png.fake.ts';
import { createBuildRequest, runBuild, type RunBuildInput } from './run-build.ts';
import { createFakeTargusApi, type FakeTargusApi } from './targus-api.fake.ts';

const sha = 'a'.repeat(40);
const base = 'b'.repeat(40);
const white: Rgba = [255, 255, 255, 255];
const red: Rgba = [255, 0, 0, 255];
const whitePng = encodeSolidPng(10, 10, white);
/** 1 of 100 pixels differs: ratio 0.01. */
const onePixelOff = encodeSolidPng(10, 10, white, { x: 3, y: 3, color: red });

function captured(
  id: string,
  png: Uint8Array,
  overrides: Partial<CaptureResult> = {},
): CaptureResult {
  return {
    id,
    variant: 'default',
    title: 'T',
    name: id,
    png,
    hash: sha256Hex(png),
    width: 10,
    height: 10,
    renderMs: 1,
    captureMs: 1,
    attempts: 1,
    stable: true,
    blank: null,
    error: null,
    ...overrides,
  };
}

function errored(id: string, error: string): CaptureResult {
  return { ...captured(id, whitePng), png: null, hash: null, width: 0, height: 0, error };
}

function report(stories: CaptureResult[], skipped: string[] = []): CaptureReport {
  return { stories, skipped, startedAt: '2026-11-04T10:00:00.000Z', durationMs: 1000 };
}

function input(
  api: FakeTargusApi,
  stories: CaptureResult[],
  overrides: Partial<RunBuildInput> = {},
): RunBuildInput {
  return {
    report: report(stories),
    git: { sha, mergeBaseSha: base, ancestors: [base] },
    ci: { branch: 'feature/x', prNumber: 3, trigger: 'pr' },
    device: 'iPhone 16',
    appearance: 'light',
    api,
    clock: createFakeClock(),
    ids: createFakeIdGenerator('run'),
    compareImages: compareWithCore,
    hash: sha256Hex,
    isBlank: isBlankPng,
    ...overrides,
  };
}

async function resultsFor(api: FakeTargusApi, stories: CaptureResult[]) {
  const output = await runBuild(input(api, stories));
  return { output, byId: new Map(output.results.map((result) => [result.storyId, result])) };
}

describe('runBuild', () => {
  it('opens a build with every captured story and no errored ones', async () => {
    const api = createFakeTargusApi();

    await runBuild(input(api, [captured('a', whitePng), errored('b', 'boom')]));

    expect(api.callsOf('createBuild')[0]?.request).toEqual({
      sha,
      branch: 'feature/x',
      prNumber: 3,
      mergeBaseSha: base,
      ancestors: [base],
      trigger: 'pr',
      device: 'iPhone 16',
      appearance: 'light',
      platform: 'ios',
      pixelRatio: null,
      snapshots: [
        { storyId: 'a', variant: 'default', imageHash: sha256Hex(whitePng), width: 10, height: 10 },
      ],
      idempotencyKey: 'run-1',
    });
  });

  it('marks a story without a baseline new and uploads it as missing', async () => {
    const api = createFakeTargusApi();

    const { output, byId } = await resultsFor(api, [captured('a', whitePng)]);

    expect(byId.get('a')).toMatchObject({
      state: 'new',
      diffHash: null,
      diffRatio: null,
      blank: true,
    });
    expect(output.uploaded).toEqual([sha256Hex(whitePng)]);
    expect(api.callsOf('getImage')).toEqual([]);
    expect(output.counts.new).toBe(1);
  });

  it('marks the same hash unchanged without downloading the baseline', async () => {
    const api = createFakeTargusApi({ baselines: { a: whitePng } });

    const { output, byId } = await resultsFor(api, [captured('a', whitePng, { blank: false })]);

    expect(byId.get('a')).toMatchObject({ state: 'unchanged', diffRatio: 0, blank: false });
    expect(api.callsOf('getImage')).toEqual([]);
    expect(output.uploaded).toEqual([]);
  });
});

describe('runBuild against a baseline', () => {
  it('marks a diff above the threshold changed and uploads the diff image', async () => {
    const api = createFakeTargusApi({ baselines: { a: whitePng } });

    const { output, byId } = await resultsFor(api, [captured('a', onePixelOff)]);

    const { diffPng } = diffImages(whitePng, onePixelOff);
    const diffHash = sha256Hex(diffPng);
    expect(byId.get('a')).toMatchObject({
      state: 'changed',
      diffRatio: 0.01,
      diffHash,
      imageHash: sha256Hex(onePixelOff),
      blank: false,
    });
    expect(api.callsOf('getImage')).toEqual([{ method: 'getImage', hash: sha256Hex(whitePng) }]);
    expect(output.uploaded).toEqual([sha256Hex(onePixelOff), diffHash]);
    expect(api.images.get(diffHash)).toEqual(diffPng);
  });

  it("diffs with the server's threshold and submits it back", async () => {
    const api = createFakeTargusApi({ baselines: { a: whitePng }, threshold: 0.05 });

    const { output, byId } = await resultsFor(api, [captured('a', onePixelOff)]);

    expect(byId.get('a')).toMatchObject({ state: 'unchanged', diffRatio: 0.01, diffHash: null });
    expect(output.uploaded).toEqual([sha256Hex(onePixelOff)]);
    expect(api.callsOf('submitResults')[0]?.request.threshold).toBe(0.05);
  });

  it('agrees with the server on a story at exactly the threshold', async () => {
    const api = createFakeTargusApi({ baselines: { a: whitePng }, threshold: 0.01 });

    const { byId } = await resultsFor(api, [captured('a', onePixelOff)]);

    const result = byId.get('a');
    const submitted = api.callsOf('submitResults')[0]?.request;
    if (result === undefined || submitted === undefined) throw new Error('expected a result');
    // What results.service.ts runs on the submitted result, with the submitted threshold.
    const server = compareSnapshot({
      current: { imageHash: sha256Hex(onePixelOff), unstable: false, error: null },
      baseline: { imageHash: sha256Hex(whitePng) },
      diffRatio: result.diffRatio,
      threshold: submitted.threshold,
      approvals: [],
    });
    expect(result).toMatchObject({ state: 'unchanged', diffRatio: 0.01, diffHash: null });
    expect(server.state).toBe(result.state);
  });

  it('marks an unstable story unstable but still records its diff', async () => {
    const api = createFakeTargusApi({ baselines: { a: whitePng } });

    const { byId } = await resultsFor(api, [captured('a', onePixelOff, { stable: false })]);

    expect(byId.get('a')).toMatchObject({ state: 'unstable', diffRatio: 0.01 });
    expect(byId.get('a')?.diffHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('runBuild with an errored story', () => {
  it('reports it with its message and no image', async () => {
    const api = createFakeTargusApi({ baselines: { a: whitePng } });

    const { output, byId } = await resultsFor(api, [errored('a', 'render threw')]);

    expect(byId.get('a')).toEqual({
      storyId: 'a',
      variant: 'default',
      title: 'T',
      name: 'a',
      state: 'error',
      imageHash: null,
      width: null,
      height: null,
      baselineHash: sha256Hex(whitePng),
      diffHash: null,
      diffRatio: null,
      error: 'render threw',
      blank: false,
    });
    expect(output.counts.error).toBe(1);
    expect(output.response.summary.errorCount).toBe(1);
  });
});

describe('runBuild uploads and submit', () => {
  it('uploads only missing captures, each hash once', async () => {
    const blue = encodeSolidPng(10, 10, [0, 0, 255, 255]);
    const api = createFakeTargusApi({ stored: [whitePng] });

    const { output } = await resultsFor(api, [
      captured('a', whitePng),
      captured('b', blue),
      captured('c', blue),
    ]);

    expect(output.uploaded).toEqual([sha256Hex(blue)]);
    expect(api.callsOf('uploadImage')).toHaveLength(1);
  });

  it('submits every result with the capture plus run duration and counts removed stories', async () => {
    const api = createFakeTargusApi({ baselines: { gone: whitePng } });
    const clock = createFakeClock();
    const slowApi: FakeTargusApi = {
      ...api,
      createBuild: async (request) => {
        clock.advance(250);
        return api.createBuild(request);
      },
    };

    const output = await runBuild(input(slowApi, [captured('a', whitePng)], { clock }));

    const [submit] = api.callsOf('submitResults');
    expect(submit?.buildId).toBe('build-1');
    expect(submit?.request.durationMs).toBe(1250);
    expect(submit?.request.results.map((result) => result.storyId)).toEqual(['a']);
    expect(output.counts).toEqual({
      unchanged: 0,
      changed: 0,
      new: 1,
      removed: 1,
      unstable: 0,
      error: 0,
    });
    expect(output.response.reviewUrl).toBe('https://targus.test/builds/build-1');
  });

  it('neither submits nor counts as removed a baseline story that is now skipped', async () => {
    const api = createFakeTargusApi({ baselines: { spinner: whitePng } });

    const output = await runBuild({
      ...input(api, [captured('a', whitePng)]),
      report: report([captured('a', whitePng)], ['spinner']),
    });

    const [submit] = api.callsOf('submitResults');
    expect(submit?.request.results.map((result) => result.storyId)).toEqual(['a']);
    expect(api.callsOf('createBuild')[0]?.request.snapshots).toHaveLength(1);
    expect(output.counts.removed).toBe(0);
    expect(output.skipped).toEqual(['spinner']);
  });
});

describe('runBuild server mismatch', () => {
  it('fails when the server asks for an image that was not captured', async () => {
    const api = createFakeTargusApi();
    const lying: FakeTargusApi = {
      ...api,
      createBuild: async (request) => ({
        ...(await api.createBuild(request)),
        missingImageHashes: ['f'.repeat(64)],
      }),
    };

    await expect(runBuild(input(lying, [captured('a', whitePng)]))).rejects.toThrow(
      'was not captured',
    );
  });
});

describe('runBuild with no stories', () => {
  it('refuses an empty story index without opening a build', async () => {
    const api = createFakeTargusApi();

    const run = runBuild(input(api, []));

    await expect(run).rejects.toMatchObject({ code: 'bad_request' });
    await expect(run).rejects.toThrow(
      /^the capture had no stories, .*`stories` glob.*or loosen --filter if the capture used one$/,
    );
    expect(api.calls).toEqual([]);
  });

  it('names the filter, without claiming the index was empty, when a filter was given', async () => {
    const api = createFakeTargusApi();

    const run = runBuild(input(api, [], { filter: 'Button' }));

    await expect(run).rejects.toThrow(
      /^no story matched --filter "Button", or the story index had none, .*: loosen --filter, or check the `stories` glob/,
    );
    expect(api.calls).toEqual([]);
  });

  it('refuses a capture whose every story is skipped, and says so', async () => {
    const api = createFakeTargusApi();
    const skippedAll = (ids: string[]) => input(api, [], { report: report([], ids) });

    await expect(runBuild(skippedAll(['a', 'b']))).rejects.toThrow(
      'all 2 stories are skipped by `parameters.targus.skip`',
    );
    await expect(runBuild(skippedAll(['a']))).rejects.toThrow('the only story is skipped');
    expect(api.calls).toEqual([]);
  });
});

describe('createBuildRequest', () => {
  it('needs a branch', () => {
    const api = createFakeTargusApi();
    const ci = { branch: null, prNumber: null, trigger: 'pr' } as const;

    expect(() => createBuildRequest(input(api, [], { ci }))).toThrow('--branch');
  });

  it('rejects an invalid sha before calling the API and caps the ancestors', () => {
    const api = createFakeTargusApi();
    const git = { sha: 'abc', mergeBaseSha: null, ancestors: [] };

    let code: string | undefined;
    try {
      createBuildRequest(input(api, [], { git }));
    } catch (error) {
      code = isTargusError(error) ? error.code : 'other';
    }
    expect(code).toBe('bad_request');
    const many = { sha, mergeBaseSha: null, ancestors: Array.from({ length: 150 }, () => base) };
    expect(createBuildRequest(input(api, [], { git: many })).ancestors).toHaveLength(100);
  });
});
