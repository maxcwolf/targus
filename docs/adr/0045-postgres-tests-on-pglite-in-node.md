# 0045. The Postgres repositories are tested in Node, on PGlite by default

## Status

accepted

## Date

2026-11-09

## Context

The API's tests run inside workerd against a local D1 (`apps/api/vitest.config.ts`), which is
where that code runs in production. The Postgres repositories (ADR 0044) run in Node on a
container host, and `docs/hosting-portability.md` asks that they be tested against a real
Postgres engine, not a double.

Two engines were tried:

- **PGlite** is Postgres itself compiled to WebAssembly, running in the test process. It needs
  no server, so `yarn check` stays one command with no Docker. It cannot load inside workerd
  (it reads its data files from disk). It has one connection, so writes never overlap, and its
  database uses the `C` collation.
- **A Postgres server** (a container) shows what PGlite cannot: connections writing at once, and
  a default collation that is not `C`. It needs Docker locally and a service in CI.

Run against a Postgres 17 server whose collation is `en_US.UTF-8`, the suites showed that both
matter: without `COLLATE "C"` two ordering assertions fail, and without the row locks of ADR 0044
two racing submissions both succeed. On PGlite none of that fails.

## Decision

We will run the Postgres tests in Node with their own vitest config,
`apps/api/vitest.postgres.config.ts`, on PGlite by default and on a server when asked.

- The tests live in `apps/api/test/postgres/`. They run the contract suites of
  `test/support/contracts/` unchanged, plus what only Postgres has (statements past the
  parameter limit, concurrent creates, schema parity).
- Each test file opens its own database, applies the committed migrations with drizzle's
  migrator as a host does, and truncates the tables before each test.
- With `TARGUS_TEST_POSTGRES_URL` set, the same tests run on that server through
  `node-postgres`, the driver a host uses, each file in a database of its own.
- `yarn workspace @targus/api test` runs the workerd tests, then the Postgres tests, then the
  drift guard, so `yarn check` covers all three.
- Coverage of `src/postgres/` is measured by the Postgres config, with the API's thresholds
  (97/94/97/97). The workerd config cannot execute those files and leaves them out.

## Consequences

### Positive

- `yarn check` proves the Postgres repositories on a real engine with no server to start.
- The same tests give a stronger answer on a real server with one environment variable.
- The Postgres code is held to the same coverage thresholds as the rest of the API.

### Negative

- The default run does not exercise concurrency or a locale collation. Until CI runs the suites
  against a Postgres service as well, that run is manual.
- The API has a second coverage report, and `apps/api/vitest.config.ts`, a guard file, names
  `src/postgres/` in its coverage excludes.
- PGlite and its WebAssembly binary are a new development dependency (about 15 MB).

## Alternatives considered

- **Run them inside workerd.** One config and one coverage report, but PGlite does not load
  there without bundling its binary into the test, and the code would be tested on a runtime it
  never runs on.
- **A Postgres container only.** The most faithful, but `yarn check` would need Docker on every
  machine, and the pre-push check would fail without it.
- **An in-memory double of Postgres (pg-mem).** No binary, but it is a reimplementation: it does
  not have Postgres's locking, collations or error codes, which are what these tests are for.
