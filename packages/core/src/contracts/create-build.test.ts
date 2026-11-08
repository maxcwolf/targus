import { describe, expect, it } from 'vitest';

import { CreateBuildRequest, CreateBuildResponse } from './index.ts';

describe('CreateBuildRequest idempotencyKey', () => {
  it('takes an optional idempotency key of printable ASCII', () => {
    const request = {
      sha: 'a'.repeat(40),
      branch: 'main',
      prNumber: null,
      mergeBaseSha: null,
      ancestors: [],
      trigger: 'main',
      device: 'iPhone 16',
      snapshots: [],
    };
    const keyed = (idempotencyKey: string) =>
      CreateBuildRequest.safeParse({ ...request, idempotencyKey }).success;

    expect(CreateBuildRequest.parse(request).idempotencyKey).toBeUndefined();
    expect(keyed('run-0f8c3e1a')).toBe(true);
    expect(keyed('k'.repeat(128))).toBe(true);
    expect([keyed(''), keyed('k'.repeat(129)), keyed('has space'), keyed('n\u00e9')]).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('CreateBuildRequest appearance', () => {
  const request = {
    sha: 'a'.repeat(40),
    branch: 'main',
    prNumber: null,
    mergeBaseSha: null,
    ancestors: [],
    trigger: 'main',
    device: 'iPhone 16',
    snapshots: [],
  };

  it('reads a request from a CLI that predates it as null', () => {
    expect(CreateBuildRequest.parse(request).appearance).toBeNull();
  });

  it('takes light or dark and nothing else', () => {
    const appearance = (value: unknown) =>
      CreateBuildRequest.safeParse({ ...request, appearance: value }).success;

    expect([appearance('light'), appearance('dark'), appearance(null)]).toEqual([true, true, true]);
    expect(appearance('auto')).toBe(false);
  });
});

describe('CreateBuildRequest platform and pixel ratio', () => {
  const request = {
    sha: 'a'.repeat(40),
    branch: 'main',
    prNumber: null,
    mergeBaseSha: null,
    ancestors: [],
    trigger: 'main',
    device: 'iPhone 16',
    snapshots: [],
  };
  const valid = (fields: object) => CreateBuildRequest.safeParse({ ...request, ...fields }).success;

  it('reads a request from a CLI that predates them as ios with no pixel ratio', () => {
    expect(CreateBuildRequest.parse(request)).toMatchObject({ platform: 'ios', pixelRatio: null });
  });

  it('takes a platform and a pixel ratio above 0 and at most 4', () => {
    const parsed = CreateBuildRequest.parse({ ...request, platform: 'web', pixelRatio: 2 });

    expect(parsed).toMatchObject({ platform: 'web', pixelRatio: 2 });
    expect([valid({ platform: 'android' }), valid({ pixelRatio: 4 })]).toEqual([true, true]);
    expect([
      valid({ platform: 'macos' }),
      valid({ pixelRatio: 0 }),
      valid({ pixelRatio: 5 }),
    ]).toEqual([false, false, false]);
  });
});

describe('CreateBuildResponse', () => {
  it('accepts a build with no baseline and requires a threshold between 0 and 1', () => {
    const hash = 'b'.repeat(64);
    const response = {
      build: { id: 'build-1', number: 1 },
      baselineBuildId: null,
      baselines: [],
      missingImageHashes: [hash],
    };

    expect(CreateBuildResponse.parse({ ...response, threshold: 0.001 })).toMatchObject({
      missingImageHashes: [hash],
      threshold: 0.001,
    });
    expect(CreateBuildResponse.safeParse(response).success).toBe(false);
    expect(CreateBuildResponse.safeParse({ ...response, threshold: 1.5 }).success).toBe(false);
  });
});
