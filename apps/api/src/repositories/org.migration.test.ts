import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

// Migration 0006 adds `orgs.github_account_id` to a table that already holds orgs. The test
// database is already migrated, so this replays the orgs statements of 0000 and 0006 against a
// renamed copy of the table, which leaves the real one alone.
const scratch = (query: string) =>
  query.replaceAll('`orgs`', '`m6_orgs`').replaceAll('orgs_github_org_unique', 'm6_orgs_unique');

/** The statements of `migration` that create, index or alter the orgs table itself. */
function orgQueries(migration: string): string[] {
  const found = env.TEST_MIGRATIONS.find((candidate) => candidate.name.startsWith(migration));
  const touchesOrgs = (query: string) =>
    ['CREATE TABLE `orgs`', 'ON `orgs`', 'ALTER TABLE `orgs`'].some((part) => query.includes(part));
  return (found?.queries ?? []).filter(touchesOrgs).map(scratch);
}

async function run(queries: readonly string[]): Promise<void> {
  for (const query of queries) await env.DB.prepare(query).run();
}

describe('migration 0006', () => {
  it('keeps every existing org and leaves its account id unknown, to be read from GitHub', async () => {
    await run(orgQueries('0000'));
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO m6_orgs (id, github_org, installation_id, created_at) VALUES ('o1', 'maxcwolf', 7, 1)",
      ),
      env.DB.prepare(
        "INSERT INTO m6_orgs (id, github_org, installation_id, created_at) VALUES ('o2', 'acme', NULL, 2)",
      ),
    ]);

    const migration = orgQueries('0006');
    expect(migration).toHaveLength(1);
    await run(migration);

    const { results } = await env.DB.prepare(
      'SELECT id, github_org, installation_id, github_account_id FROM m6_orgs ORDER BY id',
    ).run();
    expect(results).toEqual([
      { id: 'o1', github_org: 'maxcwolf', installation_id: 7, github_account_id: null },
      { id: 'o2', github_org: 'acme', installation_id: null, github_account_id: null },
    ]);
  });
});
