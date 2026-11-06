import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import {
  d1BuildHarness,
  inMemoryBuildHarness,
} from '../../test/support/contracts/build-harness.ts';
import { describeBuildPaging } from '../../test/support/contracts/build-paging.contract.ts';
import { decodeBuildCursor, encodeBuildCursor } from './build-page.ts';

describe('build cursors', () => {
  it('round-trip a build number through URL-safe text', () => {
    for (const number of [1, 62, 63, 999_999, Number.MAX_SAFE_INTEGER]) {
      const cursor = encodeBuildCursor(number);
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeBuildCursor(cursor)).toBe(number);
    }
  });
});

describeBuildPaging('D1BuildRepository (local D1)', () => d1BuildHarness(env.DB));
describeBuildPaging('in-memory builds double', inMemoryBuildHarness);
