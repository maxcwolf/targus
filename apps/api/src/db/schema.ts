import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// D1 schema (plan.md section 6). M1 holds only the tenancy roots; builds, snapshots and the
// rest arrive with M2. Every table hangs off org_id through projects (ADR 0007), and every
// foreign key is indexed to keep D1 row reads low.
//
// After editing this file run `yarn workspace @targus/api db:generate` and commit the new
// migration in migrations/.
// TODO(M2): migration drift test — `drizzle-kit generate` against this schema must produce no
// new migration (docs/engineering-standards.md section 3.2, api).

export const orgs = sqliteTable('orgs', {
  id: text('id').primaryKey(),
  githubOrg: text('github_org').notNull().unique(),
  installationId: integer('installation_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    repo: text('repo').notNull(),
    name: text('name').notNull(),
    defaultBranch: text('default_branch').notNull().default('main'),
    tokenHash: text('token_hash').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('projects_org_id_idx').on(table.orgId),
    uniqueIndex('projects_repo_unique').on(table.repo),
  ],
);
