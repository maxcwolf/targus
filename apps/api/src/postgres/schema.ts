import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Postgres schema: the same tables, columns and indexes as the SQLite schema in ../db/schema.ts,
// which stays the source for D1 (ADR 0044). Where Postgres needs a different column type:
//
// - a time is `timestamptz(3)`: milliseconds, as D1 stores and a JavaScript `Date` holds;
// - a GitHub id or a check run id is `bigint`, read as a number: they pass 2^31, and a check run
//   claim is minus a time in ms (see `checkRunClaim`);
// - a ratio is `double precision`, the 8-byte float of SQLite's REAL, not Postgres's 4-byte `real`;
// - a flag is `boolean`.
//
// test/postgres/schema-parity.test.ts fails when the two schemas name different tables, columns
// or indexes. After editing this file run `yarn workspace @targus/api db:generate:postgres` and
// commit the new migration in migrations-postgres/.

/** A point in time with millisecond precision, read as a `Date`. */
const time = (name: string) => timestamp(name, { withTimezone: true, precision: 3, mode: 'date' });
/** An integer that may pass 2^31 but stays a safe JavaScript number. */
const long = (name: string) => bigint(name, { mode: 'number' });

/** Values of `builds.status`; mirrors `BuildStatus` in @targus/core. */
const buildStatuses = ['in_progress', 'pending', 'accepted', 'denied', 'passed', 'failed'] as const;
/** Values of `builds.platform`; mirrors `Platform` in @targus/core. */
const platforms = ['ios', 'android', 'web'] as const;
/** Values of `snapshots.state`; mirrors `SnapshotState` in @targus/core. */
const snapshotStates = ['unchanged', 'changed', 'new', 'removed', 'unstable', 'error'] as const;
/** Values of `snapshots.review`; mirrors `ReviewState` in @targus/core. */
const reviewStates = ['pending', 'approved', 'denied'] as const;

export const orgs = pgTable('orgs', {
  id: text('id').primaryKey(),
  githubOrg: text('github_org').notNull().unique(),
  installationId: long('installation_id'),
  /**
   * GitHub's numeric id of the account (org or user) the installation belongs to. Unlike the
   * login in `github_org` it never changes hands, so the personal-account rule compares it
   * (ADR 0024). Null until read from the installation; cleared when the installation changes.
   */
  githubAccountId: long('github_account_id'),
  createdAt: time('created_at').notNull(),
});

export const projects = pgTable(
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
    createdAt: time('created_at').notNull(),
  },
  (table) => [
    index('projects_org_id_idx').on(table.orgId),
    uniqueIndex('projects_repo_unique').on(table.repo),
    uniqueIndex('projects_token_hash_unique').on(table.tokenHash),
  ],
);

export const builds = pgTable(
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
    // The light or dark mode the CLI pinned before capturing (ADR 0035). Null for builds opened
    // by a CLI that predates it.
    appearance: text('appearance', { enum: ['light', 'dark'] }),
    // What the build was captured on (ADR 0036): baselines, check runs and the library are per
    // platform. Builds opened before the column, or by a CLI that does not send it, are `ios`.
    platform: text('platform', { enum: platforms }).notNull().default('ios'),
    // Device pixels per point or CSS pixel of the captures; null when the CLI did not say.
    pixelRatio: doublePrecision('pixel_ratio'),
    status: text('status', { enum: buildStatuses }).notNull(),
    checkRunId: long('check_run_id'),
    createdAt: time('created_at').notNull(),
    completedAt: time('completed_at'),
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
    // SHA-256 of the results request that completed this build, so a resend of the same body
    // is answered as the first was instead of with a conflict (ADR 0031). Null while
    // `in_progress`, and for builds completed before the column existed.
    resultsDigest: text('results_digest'),
  },
  (table) => [
    // Covers the project_id foreign key and the baseline lookup by project and sha.
    index('builds_project_sha_idx').on(table.projectId, table.sha, table.createdAt),
    uniqueIndex('builds_project_number_unique').on(table.projectId, table.number),
    index('builds_baseline_build_id_idx').on(table.baselineBuildId),
    // One build per key and project. Postgres treats NULLs as distinct, so unkeyed builds never
    // collide; the repository names these columns in `ON CONFLICT`.
    uniqueIndex('builds_project_idempotency_key_unique').on(table.projectId, table.idempotencyKey),
  ],
);

export const snapshots = pgTable(
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
    diffRatio: doublePrecision('diff_ratio'),
    state: text('state', { enum: snapshotStates }).notNull(),
    review: text('review', { enum: reviewStates }).notNull(),
    reviewedBy: text('reviewed_by'),
    reviewedAt: time('reviewed_at'),
    /** Every pixel is the same colour (plan.md section 5.1, capture hygiene). */
    blank: boolean('blank').notNull().default(false),
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
    // No hash indexes: image access is scoped by project_images (ADR 0014), never by a snapshot
    // lookup, so indexing image_hash, baseline_hash or diff_hash would only slow every write.
  ],
);

export const approvals = pgTable(
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
    approvedAt: time('approved_at').notNull(),
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
    // Postgres treats NULLs as distinct in a unique index, so the index above never stops a second
    // approval of a `new` story (from_hash NULL). This one does.
    uniqueIndex('approvals_new_story_identity_unique')
      .on(table.projectId, table.storyId, table.variant, table.toHash)
      .where(sql`${table.fromHash} IS NULL`),
  ],
);

/** Metadata of every stored PNG, so "which hashes are missing" is one query. */
export const images = pgTable(
  'images',
  {
    hash: text('hash').primaryKey(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: time('created_at').notNull(),
    lastReferencedAt: time('last_referenced_at').notNull(),
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
export const projectImages = pgTable(
  'project_images',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    hash: text('hash').notNull(),
    createdAt: time('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.hash] })],
);

/** GitHub users who signed in to the review UI. */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  githubId: long('github_id').notNull().unique(),
  login: text('login').notNull(),
  avatarUrl: text('avatar_url').notNull(),
  createdAt: time('created_at').notNull(),
  lastLoginAt: time('last_login_at').notNull(),
});

/**
 * Review UI sessions. The raw session id lives only in the (signed) `targus_session` cookie;
 * the table keeps its SHA-256, so a read of the database yields no usable session (ADR 0015).
 */
export const sessions = pgTable(
  'sessions',
  {
    idHash: text('id_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: time('created_at').notNull(),
    expiresAt: time('expires_at').notNull(),
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
export const orgMemberships = pgTable(
  'org_memberships',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    member: boolean('member').notNull(),
    checkedAt: time('checked_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.orgId] }),
    index('org_memberships_org_id_idx').on(table.orgId),
  ],
);
