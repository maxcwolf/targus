# 0026. Approvals commit with the review, and check runs follow the review version

## Status

accepted

## Date

2026-11-06

## Context

ADR 0013 made a review commit only at the `review_version` it read. It left two races, listed
in its consequences:

- A decision's approvals were written after the guarded batch, as separate writes. An
  approve-all could commit, a deny on one of its snapshots could commit and withdraw that
  pair's approval, and only then could approve-all record the approval again: the snapshot
  stays denied, but later builds carry its approval forward.
- Every review updates the GitHub check run after its commit. Two reviews close together can
  finish those calls in the opposite order, so the check run shows the older summary until
  the next review.

Approve-all also re-picked the pending snapshots on each retry without saying so: a snapshot
denied while it ran was left denied, as it should be, but the response did not tell the
reviewer that it approved fewer changes than they asked for.

## Decision

We will:

1. Write a decision's approvals in the same D1 batch as the decision. `commitReview` takes
   the approvals to record and the pairs to withdraw, and runs them as guarded statements
   (`INSERT ... SELECT ... WHERE`, `DELETE ... WHERE`) before the build's version bump, under
   the same `review_version` guard as the snapshot updates. A decision that does not commit
   changes no approval, and of two decisions on one build the one committed later has the
   last word on the approvals too.
2. Keep approve-all one batch per attempt. It approves the snapshots that were pending when
   the request read the build and are still pending at the version it commits at. Those that
   another review decided first keep that decision, and the response counts them in
   `skippedCount` beside `approvedCount`. Per-snapshot commits would bump the version once per
   snapshot and send a check-run update for each; one batch keeps a single version step.
3. Re-check the version after every check-run update. A committed review knows the version it
   produced (`readVersion + 1`). After its update returns, the service reads the build's
   version through the builds repository; if a newer review has committed, it folds the newest
   snapshots with core and sends that summary, up to five times, then logs
   `check_run_update_superseded`. Whichever update finishes last is followed by such a check,
   so the check run ends on the last review's summary. The GitHub client stays a plain client.
   The same check follows a check run created late (the create-when-missing path), including
   the one the results create (as version 0). A review that loses the creation claim reads the
   build again and updates the check run another request stored meanwhile, since that request
   may have checked before the review committed; one still being created is left to the claim
   holder, which checks after storing it.

## Consequences

### Positive

- An approval exists exactly when the decision that recorded it is stored, whatever the timing.
- The check run on the pull request matches the last review once its requests have finished.
- Approve-all tells the reviewer when it left changes alone, and the web app says so.
- No schema change: the re-check uses `review_version`, which ADR 0013 already added.

### Negative

- The builds repository now writes to `approvals` as well as `builds` and `snapshots`, since a
  D1 batch is one database's transaction. The approvals repository still owns the other reads
  and writes of that table.
- A review can send a second check-run update, and a reviewer under constant contention up to
  five. Each is one small GitHub call.
- "Last" means last to finish on our side; GitHub could still apply two in-flight requests in
  another order. The next update, or the next review, corrects it.
- The approvals of different builds that share a hash pair are still last-writer-wins across
  builds, as before.

## Alternatives considered

- **Record the version last sent per build and only send newer ones.** Needs a new column and
  migration, and does not by itself fix the race: both reviews pass the check before either
  request completes, and the older one can still land last.
- **Order check-run updates in the GitHub client** (a queue per check run). Requests run in
  many Worker isolates, so there is no one place to queue them without a Durable Object.
- **Undo approvals approve-all should not have recorded**, by re-reading after it writes them.
  Another window between the re-read and the delete, and a pair-wide delete can remove an
  approval another build's review recorded legitimately.
