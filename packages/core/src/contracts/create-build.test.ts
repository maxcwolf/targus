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
