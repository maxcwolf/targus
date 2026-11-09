# 0044. Postgres is a second storage implementation, beside D1

## Status

accepted

## Date

2026-11-09

## Context

targus runs on Cloudflare's free tier (ADR 0002): D1 holds the metadata. That stays the default
and must keep working exactly as it is. A team that runs containers wants the same API on its
own stack, where the database is Postgres (`docs/hosting-portability.md`). ADR 0023 lets a host
supply its storage, and ADR 0043 put the repository interfaces in `apps/api/src/ports/`, so a
second implementation needs no change to the services or to the D1 files.

The D1 repositories lean on SQLite in ways Postgres does not share: D1 has one writer and no
interactive transaction, so ADR 0013 writes a guarded batch; SQLite compares text byte by byte;
its integers are 64-bit and its REAL is an 8-byte float; and D1 binds at most 100 parameters.

## Decision

We will add Postgres as a second implementation of every repository port, in
`apps/api/src/postgres/`, chosen by the host that composes the app. Nothing under
`repositories/`, `db/` or `migrations/` changes.

**Schema and migrations.** `src/postgres/schema.ts` declares the same tables, columns, indexes
and keys with drizzle's `pg-core`, written by hand beside the SQLite schema.
`test/postgres/schema-parity.test.ts` fails when the two differ in a name, a key, an index or a
row type. Its migrations are generated into `apps/api/migrations-postgres/`
(`yarn workspace @targus/api db:generate:postgres`) and start from one `0000_init`; the drift
guard covers both dialects. Where a column type has to differ:

| SQLite                      | Postgres           | Why                                                                                       |
| --------------------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| integer, `timestamp_ms`     | `timestamptz(3)`   | Milliseconds, as D1 stores and a JavaScript `Date` holds; reads back as the same instant  |
| integer (ids from GitHub)   | `bigint` as number | Check run ids already pass 2^31, and a check run claim is minus a time in ms              |
| real                        | `double precision` | SQLite's REAL is 8 bytes; Postgres's `real` is 4 and would round a diff ratio             |
| integer, `boolean`          | `boolean`          |                                                                                           |

**The client.** A repository takes any drizzle Postgres database (`PgDatabase`): a host passes
`drizzle-orm/node-postgres` over its pool, and the tests pass PGlite (ADR 0045). The
repositories use nothing one driver adds; "rows deleted" is counted from `RETURNING`.

**The guarded writes of ADR 0013 are transactions.** `completeWithResults` and `commitReview`
open a transaction, lock the build's row (`SELECT ... FOR UPDATE`) and check the guard under
that lock (still `in_progress`; still at the version read). A second writer waits at the lock and
then sees what the first committed, so it answers false and writes nothing. The build's own
update stays last and keeps the guard in its `WHERE`, and its row count is the answer. A rejected
row rolls the transaction back. `readForReview` reads the version and the snapshots in one
`REPEATABLE READ` transaction, as D1's batch gives one view of both.

**Build numbers.** D1 runs one statement at a time, so `MAX(number) + 1` in the insert is safe
there. Postgres runs statements side by side, so `create` first locks the project's row
(`FOR NO KEY UPDATE`, which makes creates of one project wait for each other without blocking
rows that only reference the project) and then inserts.

**Dialect differences the contract suites turn on**, each decided here, with the assertion left
as it was:

- _Text order._ The suites expect code-unit order (upper case before lower). A Postgres
  database orders by its default collation, `en_US.UTF-8` on most hosts, where "a" sorts before
  "B". Every `ORDER BY` on text names `COLLATE "C"` (`byteOrder`), so the order does not depend
  on how the database was created.
- _Foreign-key rejections._ The suites ask that a write naming a missing parent is rejected as a
  foreign-key violation. D1 says `FOREIGN KEY constraint failed`; Postgres raises SQLSTATE
  `23503`. No service reads either, so the adapter does not translate it: the test helper
  `isForeignKeyViolation` recognises each engine's own form.
- _Timestamps._ Stored as `timestamptz(3)`, they come back as the same ISO strings and `Date`s.
- _Lists._ D1 passes a list as one JSON parameter because of its 100-parameter limit. Postgres
  keeps the single JSON parameter (`json_array_elements_text`), so a list of any length is one
  parameter; multi-row inserts are chunked under the protocol's 65,535.

## Consequences

### Positive

- A container host gets the whole API on Postgres by composing `createPostgresRepositories`
  with an image store; the Cloudflare deployment is untouched.
- The same contract suites hold D1, the in-memory doubles and Postgres to one behaviour.
- The schema parity test and the two drift guards catch a migration added to one database only.

### Negative

- Every schema change is now made twice, once per dialect, with a migration for each.
- The row mappings of builds and snapshots exist twice. Sharing them would make the Postgres
  files import the D1 files; the contract suites keep the two alike.
- `ORDER BY ... COLLATE "C"` cannot use an index built with the default collation. The ordered
  reads are one build's snapshots and the project list, which are sorted in memory.
- Locking the project row serialises the opening of builds within one project.
- There is no tool yet to copy a D1 database into Postgres.

## Alternatives considered

- **Replace D1 with Postgres everywhere.** One implementation, but it ends the free Cloudflare
  deployment that ADR 0002 chose and the owner keeps as the default.
- **One schema definition for both dialects.** drizzle has no dialect-neutral table builder;
  generating one file from the other would be a tool of our own to maintain. Two files and a
  parity test are less.
- **Keep ADR 0013's guarded statements without transactions.** Statement-level guards do not
  stop two Postgres connections from interleaving between statements; a transaction with a row
  lock is the native tool and reads more simply.
- **Require a database created with the `C` collation.** It would make plain `ORDER BY` correct,
  but managed Postgres services create databases with a locale collation, and a wrong one would
  fail silently as a different order.
- **Translate Postgres errors into D1's wording.** It would keep the test helper unchanged, but
  it puts SQLite's message text into a Postgres adapter for the sake of a test.
