import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import {
  completionOf,
  d1BuildHarness,
  inMemoryBuildHarness,
  openBuild,
  records,
} from '../../test/support/contracts/build-harness.ts';
import { describeBuildResultsContract } from '../../test/support/contracts/build-results.contract.ts';

describeBuildResultsContract('D1BuildRepository (local D1)', () => d1BuildHarness(env.DB));
describeBuildResultsContract('in-memory builds double', inMemoryBuildHarness);

// Only D1 can hold the state the old non-atomic write left behind.
describe('D1BuildRepository.completeWithResults on a wedged build (local D1)', () => {
  it('replaces snapshots left on a build wedged by the old non-atomic write', async () => {
    const harness = d1BuildHarness(env.DB);
    const { buildId } = await openBuild(harness, 'wedged');
    await env.DB.prepare(
      `INSERT INTO snapshots (id, build_id, story_id, variant, state, review)
       VALUES ('wedged-stale', ?, 'story-wedged-000', 'default', 'new', 'pending')`,
    )
      .bind(buildId)
      .run();
    const fresh = records(buildId, 'wedged', 1);
    const { repository } = harness;

    expect(await repository.completeWithResults(buildId, fresh, completionOf(fresh))).toBe(true);
    expect(await repository.listSnapshots(buildId)).toEqual(fresh);
  });
});
