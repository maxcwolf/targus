import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle as drizzleServer } from 'drizzle-orm/node-postgres';
import { migrate as migrateServer } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import { afterAll, beforeEach, inject } from 'vitest';

import type { PostgresDatabase } from '../../src/postgres/database.ts';
import {
  createPostgresRepositories,
  type PostgresRepositories,
} from '../../src/postgres/storage.ts';

// The Postgres the repository tests run on (ADR 0045). By default it is PGlite, the real Postgres
// engine compiled to WebAssembly, in this process: `yarn check` needs no server. With
// TARGUS_TEST_POSTGRES_URL set it is that server through node-postgres, the driver a host uses,
// which adds what PGlite cannot show: a pool of connections writing at once, and a database
// whose default collation is not "C". Either way each test file gets its own migrated database,
// brought up with the committed migrations as a host does, and every test starts from empty
// tables.

declare module 'vitest' {
  interface ProvidedContext {
    /** Absolute path of migrations-postgres/, provided by vitest.postgres.config.ts. */
    readonly postgresMigrationsFolder: string;
    /** TARGUS_TEST_POSTGRES_URL, or null to run on PGlite. */
    readonly postgresUrl: string | null;
  }
}

const tables = [
  'approvals',
  'snapshots',
  'builds',
  'project_images',
  'images',
  'sessions',
  'org_memberships',
  'projects',
  'users',
  'orgs',
];

export interface TestPostgres {
  readonly db: PostgresDatabase;
  readonly repositories: PostgresRepositories;
  /** Run one statement and read its rows, for what no repository method returns. */
  readonly rows: Query;
}

type Query = <T>(statement: string, parameters?: unknown[]) => Promise<T[]>;

async function openPglite(): Promise<{ db: PostgresDatabase; rows: Query }> {
  const client = new PGlite();
  const db = drizzlePglite(client);
  await migratePglite(db, { migrationsFolder: inject('postgresMigrationsFolder') });
  return {
    db,
    rows: async (statement, parameters) =>
      (await client.query(statement, parameters)).rows as never,
  };
}

/**
 * A database of its own on the server, so test files running side by side do not meet. (Not a
 * schema: the generated migrations name `public` in their foreign keys.)
 */
async function openServer(
  url: string,
  name: string,
): Promise<{ db: PostgresDatabase; rows: Query }> {
  const database = `targus_test_${name}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${database}"`);
  await admin.end();
  const own = new URL(url);
  own.pathname = `/${database}`;
  const pool = new pg.Pool({ connectionString: own.href, max: 8 });
  afterAll(() => pool.end());
  const db = drizzleServer(pool);
  await migrateServer(db, { migrationsFolder: inject('postgresMigrationsFolder') });
  return {
    db,
    rows: async (statement, parameters) => (await pool.query(statement, parameters)).rows as never,
  };
}

/**
 * A migrated, empty database for the calling test file, emptied again before each test. `name`
 * is the file's own (lower case letters and underscores): on a server it names the database.
 */
export async function openTestPostgres(name: string): Promise<TestPostgres> {
  const url = inject('postgresUrl');
  const { db, rows } = url === null ? await openPglite() : await openServer(url, name);
  beforeEach(async () => {
    await db.execute(sql.raw(`TRUNCATE ${tables.join(', ')}`));
  });
  return { db, repositories: createPostgresRepositories(db), rows };
}
