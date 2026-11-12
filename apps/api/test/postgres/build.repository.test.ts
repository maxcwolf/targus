import { describe, expect, it } from 'vitest';

import { postgresMaxBoundParameters } from '../../src/postgres/database.ts';
import { completionOf, openBuild, records } from '../support/contracts/build-harness.ts';
import { describeBuildHistory } from '../support/contracts/build-history.contract.ts';
import { describeBuildPaging } from '../support/contracts/build-paging.contract.ts';
import { describeBuildResultsContract } from '../support/contracts/build-results.contract.ts';
import { describeBuildReviewContract } from '../support/contracts/build-review.contract.ts';
import { describeBuildContract } from '../support/contracts/build.contract.ts';
import { newBuild } from '../support/fixtures.ts';
import { postgresBuildHarness } from './build-harness.ts';
import { openTestPostgres } from './database.ts';

const postgres = await openTestPostgres('builds');
const harness = () => postgresBuildHarness(postgres);

describeBuildContract('PostgresBuildRepository (Postgres)', harness);
describeBuildResultsContract('PostgresBuildRepository (Postgres)', harness);
describeBuildReviewContract('PostgresBuildRepository (Postgres)', harness);
describeBuildPaging('PostgresBuildRepository (Postgres)', harness);
describeBuildHistory('PostgresBuildRepository (Postgres)', harness);

describe('PostgresBuildRepository.completeWithResults (Postgres)', () => {
  // A database copied from D1 may still hold a build the old non-atomic write wedged.
  it('replaces snapshots left on an in_progress build', async () => {
    const { buildId } = await openBuild(harness(), 'wedged');
    await postgres.rows(
      `INSERT INTO snapshots (id, build_id, story_id, variant, state, review)
       VALUES ('wedged-stale', $1, 'story-wedged-000', 'default', 'new', 'pending')`,
      [buildId],
    );
    const fresh = records(buildId, 'wedged', 1);
    const { repository } = harness();

    expect(await repository.completeWithResults(buildId, fresh, completionOf(fresh))).toBe(true);
    expect(await repository.listSnapshots(buildId)).toEqual(fresh);
  });

  it('stores more snapshots than one statement can bind parameters for', async () => {
    const { buildId } = await openBuild(harness(), 'many');
    const columns = 18;
    const many = records(buildId, 'many', Math.floor(postgresMaxBoundParameters / columns) + 5);
    const { repository } = harness();

    expect(await repository.completeWithResults(buildId, many, completionOf(many))).toBe(true);
    expect(await repository.listSnapshots(buildId)).toHaveLength(many.length);
  });

  it('answers false for a build that does not exist', async () => {
    const { repository } = harness();
    expect(await repository.completeWithResults('build-none', [], completionOf([]))).toBe(false);
  });
});

describe('PostgresBuildRepository.create (Postgres)', () => {
  // On a server these run on separate connections at once; without the lock on the project's
  // row two of them read the same highest number and one fails on the unique index.
  it('numbers builds opened at the same time 1 to n, with no number taken twice', async () => {
    const { repository, seedProject } = harness();
    const projectId = await seedProject('at-once');
    const ids = Array.from({ length: 12 }, (_, index) => `build-at-once-${String(index)}`);

    const created = await Promise.all(ids.map((id) => repository.create(newBuild(id, projectId))));

    expect(created.map((build) => build.number).sort((a, b) => a - b)).toEqual(
      ids.map((_, index) => index + 1),
    );
  });
});
