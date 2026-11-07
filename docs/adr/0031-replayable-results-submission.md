# 0031. A digest of the request makes submitting results safe to replay

## Status

accepted, amended 2026-11-07

## Amended by

Review of PR 50, 2026-11-07: a replay that finds another request holding the creation claim no
longer answers `failed`, which told the CLI that GitHub had failed while the first attempt was
still creating the check run. `CheckRunMissing` gains `pending` for that case, and point 4 and the
consequences below say so.

## Date

2026-11-07

## Context

`POST /api/builds/:id/results` stores the results only while the build is `in_progress`
(ADR 0013), and the CLI retries it on network errors, timeouts, 429 and 5xx (ADR 0027). When
the first attempt committed and only its response was lost, the retry found the build complete
and got 409 `conflict`. The run failed after a capture that takes minutes, and running it again
opened a second build for the same commit.

The retry was also the only request left that could create a missing check run for a build with
nothing to review. Creating the check run is best effort after the results commit (ADR 0026):
when GitHub fails, the next review creates it. A build with no `changed` or `new` stories gets no
review, so its pull request kept no check run at all.

## Decision

We will answer a resend of the request that completed a build as if it were the first, and keep
refusing other results:

1. The server recognises a replay by a digest of the request: the SHA-256 of the validated
   `SubmitResultsRequest` serialised as JSON. The schema fixes the key order, and the CLI resends
   the body it sent first, so every attempt of one submission has the same digest, and any other
   body, down to a different `durationMs`, has another.
2. `completeWithResults` stores the digest in `builds.results_digest` (nullable, migration 0009)
   in the same guarded update that moves the build out of `in_progress`, so a build has a digest
   exactly when it has results.
3. A submission for a build that is no longer `in_progress`, or whose write lost the race to
   another submission, reads the stored digest. The same digest answers 200 with the shape of the
   first response: the build's id and number, its review URL, and its summary folded from the
   snapshots as they are now, since a review may have decided changes in between. Any other
   digest, or none (a build completed before migration 0009), answers 409 `conflict` and writes
   nothing.
4. A replay for a build that has no check run tries to create it, in the state of the summary it
   answers, and then follows newer reviews as any late creation does (ADR 0026). The creation
   claim still prevents a second check run: a replay that loses the claim reads the build once
   more and answers the check run if its creator stored it in between; otherwise it says
   `checkRunMissing: pending` and leaves the creation, and following newer reviews, to the claim
   holder. It does not wait for the holder: the API has no sleep, and the CLI retries only after
   its own timeout, so the holder has had that long already. `failed` stays for a GitHub or D1
   failure in the replay's own attempt. A build that has a check run returns its id without
   calling GitHub.
5. The CLI does not change: it already retries this request with the same serialised body, and
   now the retry ends the run normally.

## Consequences

### Positive

- A lost response no longer fails the run or leads to a second build for the commit.
- A build with nothing to review gets its check run on the retry when GitHub failed the first
  time.
- No client change: any CLI that retries benefits, including those released before this.
- Two racing copies of one submission both succeed; one stores it.

### Negative

- Production needs migration 0009 applied before the Worker that writes the column is deployed.
- Every submission hashes its body once more, and every replay reads the digest and the
  snapshots back.
- The digest is tied to how the schema serialises a request. A deploy that adds a defaulted field
  between an attempt and its retry turns that retry into a 409, as before this change.
- A replay answers the summary as of now, not the one the first attempt answered. It differs only
  when a review committed in between, and then the newer summary is the one the run should see.
- A replay that loses the creation claim to a request that then fails reports `pending`, and so
  does one that meets a claim left by a request that died, until the claim goes stale after five
  minutes; the next review or replay tries again.

## Alternatives considered

- **An idempotency key in `SubmitResultsRequest`**, as ADR 0027 does for opening a build. The
  build id already names the run, so a key adds nothing to recognise it; a key alone would also
  replay a different body sent under the same key, so the body would still need comparing to keep
  the 409, and only new CLIs would send one.
- **Compare the request with the stored snapshots.** No new column, but the request carries fields
  the snapshots do not keep (`durationMs`, the CLI's own `state`), so a different body could pass
  as a replay, and the comparison would have to track every field added to `StoryResult`.
- **Let the CLI read the build after a 409** and treat a completed build as success. It cannot tell
  its own results from another submission's, and needs another request and its own retries.
