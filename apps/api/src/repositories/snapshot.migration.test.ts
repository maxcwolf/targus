import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

// Migration 0008 drops the three snapshot hash indexes, which nothing has read since image
// access moved to project_images (ADR 0014). The test database is already migrated.
async function snapshotIndexes(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'snapshots' AND sql IS NOT NULL ORDER BY name",
  ).run<{ name: string }>();
  return results.map((row) => row.name);
}

describe('migration 0008', () => {
  it('leaves the snapshots table with only its build, story and variant index', async () => {
    expect(await snapshotIndexes()).toEqual(['snapshots_build_story_variant_unique']);
  });

  it('can be applied again without failing', async () => {
    const found = env.TEST_MIGRATIONS.find((candidate) => candidate.name.startsWith('0008'));
    const queries = found?.queries ?? [];
    expect(queries).toHaveLength(3);
    for (const query of queries) await env.DB.prepare(query).run();
    expect(await snapshotIndexes()).toEqual(['snapshots_build_story_variant_unique']);
  });
});
