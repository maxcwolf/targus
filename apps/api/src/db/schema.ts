import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// D1 schema (plan.md section 6). Tenant data hangs off org_id through projects (ADR 0007), and
// every foreign key and every lookup the repositories run is indexed to keep D1 row reads low
// (plan.md section 9).
//
// After editing this file run `yarn workspace @targus/api db:generate` and commit the new
// migration in migrations/. `test/node/migration-drift.test.ts` fails when they disagree.

/** Values of `builds.status`; mirrors `BuildStatus` in @targus/core. */
const buildStatuses = ['in_progress', 'pending', 'accepted', 'denied', 'passed', 'failed'] as const;
/** Values of `snapshots.state`; mirrors `SnapshotState` in @targus/core. */
const snapshotStates = ['unchanged', 'changed', 'new', 'removed', 'unstable', 'error'] as const;
/** Values of `snapshots.review`; mirrors `ReviewState` in @targus/core. */
const reviewStates = ['pending', 'approved', 'denied'] as const;

export const orgs = sqliteTable('orgs', {
  id: text('id').primaryKey(),
  githubOrg: text('github_org').notNull().unique(),
  installationId: integer('installation_id'),
  /**
   * GitHub's numeric id of the account (org or user) the installation belongs to. Unlike the
   * login in `github_org` it never changes hands, so the personal-account rule compares it
   * (ADR 0024). Null until read from the installation; cleared when the installation changes.
   */
  githubAccountId: integer('github_account_id'),
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
    uniqueIndex('projects_token_hash_unique').on(table.tokenHash),
  ],
);

export const builds = sqliteTable(
  'builds',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    number: integer('number').notNull(),
    sha: text('sha').notNull(),
    branch: text('branch').notNull(),
    prNumber: integer('pr_number'),
    mergeBaseSha: text('merge_base_sha'),
    baselineBuildId: text('baseline_build_id'),
    trigger: text('trigger', { enum: ['pr', 'main'] }).notNull(),
    device: text('device').notNull(),
    status: text('status', { enum: buildStatuses }).notNull(),
    checkRunId: integer('check_run_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    // Bumped by every review write. A review commits only if it is still the version it read
    // the snapshots at, so its tally is never computed from a stale copy (ADR 0013).
    reviewVersion: integer('review_version').notNull().default(0),
    // The persisted `SnapshotTally` of core, so the builds list and the build page derive the
    // status and counts without reading snapshots.
    pendingCount: integer('pending_count').notNull().default(0),
    deniedCount: integer('denied_count').notNull().default(0),
    unchangedCount: integer('unchanged_count').notNull().default(0),
    changedCount: integer('changed_count').notNull().default(0),
    newCount: integer('new_count').notNull().default(0),
    removedCount: integer('removed_count').notNull().default(0),
    unstableCount: integer('unstable_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    // The CLI's key for this build, so a retried `POST /api/builds` returns this build instead
    // of opening another (ADR 0027). Null for a build opened without one.
    idempotencyKey: text('idempotency_key'),
  },
  (table) => [
    // Covers the project_id foreign key and the baseline lookup by project and sha.
    index('builds_project_sha_idx').on(table.projectId, table.sha, table.createdAt),
    uniqueIndex('builds_project_number_unique').on(table.projectId, table.number),
    index('builds_baseline_build_id_idx').on(table.baselineBuildId),
    // One build per key and project. SQLite treats NULLs as distinct, so unkeyed builds never
    // collide; the D1 adapter names these columns in `ON CONFLICT`.
    uniqueIndex('builds_project_idempotency_key_unique').on(table.projectId, table.idempotencyKey),
  ],
);

export const snapshots = sqliteTable(
  'snapshots',
  {
    id: text('id').primaryKey(),
    buildId: text('build_id')
      .notNull()
      .references(() => builds.id),
    storyId: text('story_id').notNull(),
    variant: text('variant').notNull(),
    /** Storybook component title and story name; null for `removed` stories. */
    title: text('title'),
    name: text('name'),
    imageHash: text('image_hash'),
    width: integer('width'),
    height: integer('height'),
    baselineHash: text('baseline_hash'),
    diffHash: text('diff_hash'),
    diffRatio: real('diff_ratio'),
    state: text('state', { enum: snapshotStates }).notNull(),
    review: text('review', { enum: reviewStates }).notNull(),
    reviewedBy: text('reviewed_by'),
    reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' }),
    /** Every pixel is the same colour (plan.md section 5.1, capture hygiene). */
    blank: integer('blank', { mode: 'boolean' }).notNull().default(false),
    /** The render error of an `error` snapshot (ADR 0004, rule 6). */
    error: text('error'),
  },
  (table) => [
    // Covers the build_id foreign key and "snapshots of a build".
    uniqueIndex('snapshots_build_story_variant_unique').on(
      table.buildId,
      table.storyId,
      table.variant,
    ),
    // "Which projects reference this image", for authorizing a reviewer's image read.
    index('snapshots_image_hash_idx').on(table.imageHash),
    index('snapshots_baseline_hash_idx').on(table.baselineHash),
    index('snapshots_diff_hash_idx').on(table.diffHash),
  ],
);

export const approvals = sqliteTable(
  'approvals',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    storyId: text('story_id').notNull(),
    variant: text('variant').notNull(),
    /** Null when a `new` story was approved. */
    fromHash: text('from_hash'),
    toHash: text('to_hash').notNull(),
    approvedBy: text('approved_by').notNull(),
    approvedAt: integer('approved_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    // An approval's identity, so a hash pair is approved at most once. Also covers the
    // project_id foreign key and the carry-forward match (plan.md section 6, rule 3).
    uniqueIndex('approvals_identity_unique').on(
      table.projectId,
      table.storyId,
      table.variant,
      table.fromHash,
      table.toHash,
    ),
    // SQLite treats NULLs as distinct in a unique index, so the index above never stops a second
    // approval of a `new` story (from_hash NULL). This one does.
    uniqueIndex('approvals_new_story_identity_unique')
      .on(table.projectId, table.storyId, table.variant, table.toHash)
      .where(sql`${table.fromHash} IS NULL`),
  ],
);

/** Metadata of every PNG in R2, so "which hashes are missing" is one D1 query. */
export const images = sqliteTable(
  'images',
  {
    hash: text('hash').primaryKey(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastReferencedAt: integer('last_referenced_at', { mode: 'timestamp_ms' }).notNull(),
  },
  // For the v1.1 retention job: images not referenced in the last 90 days (plan.md section 9).
  (table) => [index('images_last_referenced_at_idx').on(table.lastReferencedAt)],
);

/**
 * Which project uploaded which image. `images` is shared by every tenant (the bytes are
 * content-addressed), so this table is what scopes it (ADR 0014): a project may read a hash, or
 * name it in its results, only after sending the bytes itself. Knowing a hash proves nothing.
 * The primary key covers the project_id foreign key and both lookups.
 */
export const projectImages = sqliteTable(
  'project_images',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    hash: text('hash').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.hash] })],
);

/** GitHub users who signed in to the review UI. */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  githubId: integer('github_id').notNull().unique(),
  login: text('login').notNull(),
  avatarUrl: text('avatar_url').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * Review UI sessions. The raw session id lives only in the (signed) `targus_session` cookie;
 * the table keeps its SHA-256, so a read of D1 yields no usable session (ADR 0015).
 */
export const sessions = sqliteTable(
  'sessions',
  {
    idHash: text('id_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  // user_id covers the foreign key; expires_at serves the cleanup of expired sessions at sign-in.
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

/**
 * Cached answers to "is this user a member of this GitHub org", re-checked after an hour
 * (plan.md section 5.2). The primary key covers the user_id foreign key.
 */
export const orgMemberships = sqliteTable(
  'org_memberships',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    member: integer('member', { mode: 'boolean' }).notNull(),
    checkedAt: integer('checked_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.orgId] }),
    index('org_memberships_org_id_idx').on(table.orgId),
  ],
);
