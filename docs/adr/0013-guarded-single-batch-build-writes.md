# 0013. Guarded single-batch writes for build results and reviews

## Status

accepted

## Date

2026-11-05

## Context

D1 has no interactive transactions: a Worker cannot read, decide in TypeScript and write
inside one transaction. It does run a `batch` of statements as one transaction. Two writes
change a build after it is created, and both read before they write:

- Submitting results stored the snapshots, called GitHub, then completed the build, as
  separate writes. A failure in between left snapshots on an `in_progress` build, and every
  retry then failed on the unique index and answered 500.
- A review updated the snapshot, re-read all snapshots, folded the tally and status in
  TypeScript (core's `tallySnapshots`, `buildStatusFromTally`) and wrote them back. Two
  reviewers at once could each write a tally computed before the other's change.

Approvals were checked with a read and then inserted, against a non-unique index, so two
requests could record the same approval twice.

## Decision

We will make every write that changes a build's state one D1 batch whose statements are all
guarded by the state the caller read, with the build row's update last:

1. Results: `completeWithResults` inserts the snapshots and sets status, tally and
   `completed_at`, each statement guarded by the build still being `in_progress`. A false
   result means another submission won, which the API answers with 409.
2. Reviews: `builds.review_version` is bumped by every review. A review reads the snapshots
   and the version together, folds the tally with core, and `commitReview` writes the
   decision and the tally guarded by that version. If another review committed first nothing
   is written, and the service reads again and retries (five attempts, then 409).
3. Approvals: an approval's identity `(project_id, story_id, variant, from_hash, to_hash)` is
   unique, with a second, partial unique index for `from_hash IS NULL` because SQLite treats
   NULLs as distinct. Recording an approval is an insert that ignores the conflict.

GitHub calls happen after the batch and are best effort; they never decide whether data is
stored.

## Consequences

### Positive

- A build is never half-written: retries are either a no-op conflict or a clean first write.
- The build's tally always matches its snapshots as stored, and the rules stay in core.
- Duplicate approvals cannot be inserted, whatever the timing.

### Negative

- Guarded inserts are raw `INSERT ... SELECT ... WHERE` SQL, since drizzle cannot express
  them, and run through D1's own `batch` because drizzle's cannot bind raw statements.
- Under contention a review can fail with 409 after five lost races and must be retried.
- The approvals table and the snapshot decision are separate writes, so a deny racing an
  approve-all on the same snapshot can still leave an approval for a denied snapshot.
- The GitHub check run is updated after the commit, so two reviews' updates can still reach
  GitHub out of order and leave the check run one decision behind until the next review.

## Alternatives considered

- **Fold the tally in SQL** (counts as `SUM(...)` over snapshots in the same statement). No
  version column or retry, but the tally and status rules would exist in SQL as well as core.
- **Trigger rejecting snapshot inserts on a completed build.** Enforced in the schema, but a
  hidden rule, and the failure has to be recognised by its error message.
