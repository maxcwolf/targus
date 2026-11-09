# 0043. The API's repository interfaces live in a ports directory

## Status

accepted

## Date

2026-11-09

## Context

ADR 0023 made the API a function of plain dependencies, and `composition.ts` lets a host supply
its own storage (`StorageDeps`). The interfaces of that storage did not follow: each repository
interface (`ProjectRepository`, `ApiBuildRepository`, `ImageRepository` and the rest) and its
record types were declared in the D1 file that implements them. So a service that named
`Project` imported `repositories/project.repository.ts`, and with it `drizzle-orm/d1` and the
SQLite schema. The in-memory doubles and the contract suites imported the same files.

That was harmless while D1 was the only database. A second implementation (Postgres, for a
container host; `docs/hosting-portability.md`) would have had to import its interface from the
D1 file it stands beside, and nothing stopped a service from reaching a D1 helper.

## Decision

We will keep every repository interface of the API, and the record types they exchange, in
`apps/api/src/ports/`, one file per repository (`build-repository.ts`,
`project-repository.ts`, ...).

- A port file imports only `@targus/core` and other port files. It holds types, plus the rules
  that every implementation must share to behave alike: today the keyset paging of builds
  (`build-page.ts`).
- Services, middleware, `composition.ts`, the test doubles and the contract suites import a
  repository's types from `ports/`. Files under `repositories/` and `storage/` import the
  interface they implement from `ports/` and export only the implementation.
- Only a host's composition (`src/cloudflare/` today) and tests import an implementation.
- `core` keeps the ports that more than one package uses (`BuildRepository`, `ImageStore`, ...).
  `ApiBuildRepository` extends core's `BuildRepository` as before.

## Consequences

### Positive

- A storage implementation for another database is a new directory that imports `ports/`; no
  D1 file changes, and no service does.
- The services' imports now show what they depend on: interfaces, not an adapter.
- The rule can be guarded: after this change no file outside `repositories/`, `storage/`,
  `cloudflare/` and tests imports `repositories/`, `storage/` or `db/`.

### Negative

- An interface and its first implementation are no longer read in one file.
- Until the dependency-cruiser rule proposed with this change is added by a maintainer (the
  guard files are CODEOWNERS-protected), the rule is held by review only.

## Alternatives considered

- **Move the interfaces into `packages/core/src/ports/`.** Core already has `BuildRepository`.
  But sessions, memberships, upload records and the review commit are the API's own concerns;
  no other package uses them, and core would grow with every API table.
- **Leave the interfaces where they are and import them from the D1 files.** No change now, but
  every other implementation and every service keeps a compile-time edge to `drizzle-orm/d1`.
