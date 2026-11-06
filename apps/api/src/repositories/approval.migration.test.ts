import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { imageHash, newProject } from '../../test/support/fixtures.js';
import { createProjectRepository } from './project.repository.js';

// Migration 0004 removes duplicate approvals before it makes an approval's identity unique.
// The test database is already migrated, so this replays the approvals statements of 0001
// and 0004 against a renamed copy of the table, which leaves the real one alone.
const scratch = (query: string) => query.replaceAll('approvals', 'm4_approvals');

function approvalQueries(migration: string): string[] {
  const found = env.TEST_MIGRATIONS.find((candidate) => candidate.name.startsWith(migration));
  return (found?.queries ?? []).filter((query) => query.includes('`approvals`')).map(scratch);
}

async function run(queries: readonly string[]): Promise<void> {
  for (const query of queries) await env.DB.prepare(query).run();
}

/** One approval row; `fromHash` null is the approval of a `new` story. */
function row(id: string, fromHash: string | null, toHash: string, approvedAt: number) {
  return env.DB.prepare(
    `INSERT INTO m4_approvals (id, project_id, story_id, variant, from_hash, to_hash, approved_by, approved_at)
     VALUES (?, 'project-m4', 'card', 'default', ?, ?, 'octocat', ?)`,
  ).bind(id, fromHash, toHash, approvedAt);
}

describe('migration 0004', () => {
  it('keeps the earliest approval of each identity, a null fromHash included', async () => {
    await createProjectRepository(env.DB).create(newProject('m4'));
    await run(approvalQueries('0001'));
    const [one, two, three] = [imageHash('1'), imageHash('2'), imageHash('3')];
    await env.DB.batch([
      row('changed-late', one, two, 300),
      row('changed-early', one, two, 100),
      row('changed-mid', one, two, 200),
      row('new-b', null, two, 100),
      row('new-a', null, two, 100),
      row('new-other', null, three, 400),
      row('changed-other', one, three, 500),
    ]);

    const migration = approvalQueries('0004');
    expect(migration.some((query) => query.includes('DELETE FROM'))).toBe(true);
    await run(migration);

    const { results } = await env.DB.prepare('SELECT id FROM m4_approvals ORDER BY id').run<{
      id: string;
    }>();
    expect(results.map((kept) => kept.id)).toEqual([
      'changed-early',
      'changed-other',
      'new-a',
      'new-other',
    ]);
    await expect(row('new-again', null, two, 600).run()).rejects.toThrow(/UNIQUE/);
  });
});
