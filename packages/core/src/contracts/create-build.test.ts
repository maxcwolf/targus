import { describe, expect, it } from 'vitest';

import { CreateBuildRequest } from './index.ts';

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
