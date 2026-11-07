# 0030. An unstable capture never becomes the baseline

## Status

accepted

## Date

2026-11-06

## Context

The CLI captures each story twice, a short gap apart, and retries with a doubled settle when the
two differ. A story whose captures still differ after the last attempt is `unstable`: in the pilot app,
16 of 354 stories, every one with a native `ActivityIndicator`, which cannot be frozen from JS
(docs/capture-spike.md). The v1 policy is that an `unstable` story is reported and shown in the
UI but never blocks the check, so `compareSnapshot` stores it with review `approved`.

ADR 0004, rule 5, says the accepted image of a story is its `image_hash` when it is approved or
unchanged, else its `baseline_hash`, and that is what the next build compares against.
`acceptedImageHash` applied that rule to every `approved` snapshot, including `unstable` ones.
An unstable capture therefore became the next baseline without anyone reviewing it. Since an
`unstable` snapshot is not reviewable, it could not be denied either. A real regression in a
story with a spinner was adopted silently: the build with the regression passed as unstable, and
every later build compared against the regressed image, so the change never surfaced again.

The `approved` review on an `unstable` snapshot means "does not block", not "a reviewer accepted
this image". Rule 5 read it as the second.

## Decision

We will never let an `unstable` capture become the baseline.

- `acceptedImageHash` returns the snapshot's `baselineHash` for state `unstable`, as it already
  does for `error` (ADR 0004, rule 6). The story keeps the image a reviewer last accepted, or
  the unchanged image it last matched.
- `unstable` is only reached with a baseline (a story without one is `new` first), so an
  unstable story always has a previous accepted image to keep.
- `unstable` still never blocks the check; its review stays `approved` and it stays
  unreviewable.
- The next build compares against the kept image. When it captures the story stably, a
  difference goes through normal review (`changed`, `pending` unless an approval for the exact
  hash pair exists), and a match is `unchanged`.
- Everything that derives baselines goes through `acceptedImageHash`: the baselines
  `POST /api/builds` returns, the comparison `POST /api/builds/:id/results` classifies with, and
  the library page (`libraryStories`). No stored data changes; builds already stored are read
  with the new rule.

Rule 5 of ADR 0004 now reads: the accepted image for a story in a build is `image_hash` when it
is unchanged, or approved and not `unstable`, else `baseline_hash`.

## Consequences

### Positive

- A regression in a story with a spinner cannot become the baseline unreviewed. It shows up as
  `changed` on the first build that captures the story stably.
- The baseline of every story is an image a reviewer approved or one that matched a previous
  baseline, never one nobody looked at.
- The change is one rule in core, and every consumer follows it.

### Negative

- A story that is unstable on every run keeps its old baseline until it captures stably once.
  Any change to it in the meantime, intended or not, piles up and surfaces as one `changed`
  story on that first stable build, possibly long after the commit that caused it.
- The library page shows the kept image for an unstable story, not the latest capture, so it
  can look stale for a story that changed on purpose while it was unstable.
- Builds stored under the old rule may already hold a chain of unstable captures as baselines.
  The new rule only steps the kept baseline back one build, to the stored `baseline_hash`, which
  may itself be an earlier unstable capture; it does not repair that chain.
- The related open item A4 in the improvement tracker is not changed here: a change at or under the diff threshold is stored
  as `unchanged`, and its capture still becomes the baseline, so small changes can still
  accumulate across builds without review.

## Alternatives considered

- **Make `unstable` reviewable, and adopt the capture only when a reviewer approves it.** It
  would let a reviewer accept a spinner story's new look, but every unstable story would then
  ask for review on every build, since its capture differs each time. That is the noise the
  stability check exists to remove, and it would block the check for 16 of the pilot app's stories.
- **Store `unstable` as `pending` but leave it out of the check.** The same result for the
  baseline with a less honest review state, and the UI, the tally and the approval carry-forward
  would all need a special case for a pending snapshot that does not count.
- **Keep adopting the capture (the state before this ADR).** Silent adoption of regressions in
  any story with a spinner, which this ADR exists to stop.
