# 0027. An idempotency key makes opening a build safe to retry

## Status

accepted

## Date

2026-11-06

## Context

The CLI gives every API request a timeout and retries the idempotent ones on network errors,
timeouts, 429 and 5xx (PR 11). Image uploads are content-addressed and a results submission is
stored only while its build is `in_progress` (ADR 0013), so resending either is safe.
`POST /api/builds` was the exception: each request opened a new build, so a retry after a lost
response would leave a second build stuck `in_progress` with no results, and its PR would show
the stray build's check run never finishing. The CLI therefore sent it once, and a network blip
at the moment the build opened failed the whole run after a capture that takes minutes.

## Decision

We will make `POST /api/builds` idempotent under a key the caller chooses:

- `CreateBuildRequest` takes an optional `idempotencyKey` (1 to 128 printable ASCII characters).
  It is a body field, not an `Idempotency-Key` header: the body is the zod contract in core that
  the route already validates, so the key is checked, typed and documented with the rest of the
  request, the route stays "parse, call one service, map", and the CLI's `TargusApi` port keeps a
  single argument. The header convention matters to generic HTTP tooling, which the CLI is not.
- `targus run` takes one key per run from the `IdGenerator` port (`cryptoIdGenerator`, a UUID)
  when it builds the request body; the client resends that body unchanged, so every attempt
  carries the same key. `TargusApiClient.createBuild` retries with the default policy when the
  request has a key and sends it once when it has none.
- D1 stores the key in `builds.idempotency_key` (nullable, migration 0007), unique per project
  (`builds_project_idempotency_key_unique`). The insert is an upsert on that index that leaves
  the stored row unchanged and returns it, so concurrent attempts open one build between them and
  the loser reads the winner's row in the same statement. Builds without a key store NULL, which
  SQLite treats as distinct, so they never collide. The key is scoped by project: two projects
  may use the same key.
- A request whose key the project already used answers 201 with that build's id and number, its
  stored baseline (not one resolved again: a newer baseline may have appeared since) and the
  hashes still missing now, so a retry after the uploads started asks only for what is left.
- The same key with a different build is a client bug. It answers 409 `conflict` naming the
  build and the fields that differ, and writes nothing. "Different" compares the fields the build
  row stores (sha, branch, PR number, merge base, trigger, device); the snapshot list is not
  stored on the build, so it is not compared.
- A request without a key behaves as before, so a CLI released before this change still works.

## Consequences

### Positive

- A lost response while the build opens no longer fails the run or leaves a stray build.
- Every CLI request is now retried, so the retry rules have no exception to explain.
- The contract suite runs the same upsert cases, including concurrent replays and a taken id
  under a new key, against D1 and the in-memory double.

### Negative

- Production needs migration 0007 applied before the Worker that writes the column is deployed.
- The unique index adds a little write cost to every build insert.
- Keys are kept forever with their builds. A key reused by a later run of the same project
  replays the old build; the CLI never reuses one, and the 409 catches a reuse with another sha.
- A replay with the same build fields but a different snapshot list returns the original build
  instead of a 409. Only a client that reuses a key across captures can do this.

## Alternatives considered

- **An `Idempotency-Key` header.** The common HTTP convention, but the key would live outside the
  validated body, the route would read a header the contract does not describe, and the CLI's
  port would need a second argument. Nothing outside targus calls this endpoint.
- **A server-derived key (project, sha, device).** No client change, but two legitimate runs on
  the same commit, such as a rerun after a denied review, would collapse into one build.
- **A stored request fingerprint, to compare the whole body.** Catches a changed snapshot list,
  at the cost of hashing the body and another column, for a mistake only a buggy client makes.
- **Let the CLI find its build after a failure (`GET` by sha).** Needs a new endpoint and still
  races with a concurrent run on the same commit.
