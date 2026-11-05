# 0004. Baseline and approval rules

## Status

accepted

## Date

2026-11-04

## Context

Each build needs a baseline to compare against, and approvals must not force re-review every
time a PR is re-pushed or merged. Chromatic tracks per-branch baseline ancestry across
arbitrary branches; plan.md lists that as a non-goal for v1. The CLI sends `sha`, `branch`, PR
number, `mergeBase` with the default branch, and the first-parent ancestor list of the merge
base (`git rev-list --first-parent -n 100`).

## Decision

We will apply these six rules, implemented as pure functions in `packages/core`
(`resolveBaseline`, `compareSnapshot`, `buildStatus`):

1. A PR build's baseline is the most recent successful build on its merge-base commit, else
   the nearest first-parent ancestor with one.
2. A snapshot is `unchanged` when hashes match or the diff ratio is under the threshold, `new`
   when the baseline lacks the story, and `removed` when the baseline has a story the build
   lacks.
3. Approving a `changed` snapshot records an approval for that story as a `from_hash` to
   `to_hash` pair. Later builds on any branch whose snapshot matches the same pair are
   auto-approved, so re-pushing a PR does not require re-review.
4. A `main` build applies rule 3, so changes approved on a PR auto-accept on merge. Anything
   still `changed` on main is `pending` and surfaces in the UI, since it reached main without
   review.
5. The accepted image for a story in a build is `image_hash` when approved or unchanged, else
   `baseline_hash`. That is what the next build compares against.
6. A story whose render errors is stored with state `error`, keeps its previous accepted image
   as baseline, and fails the build until a later build captures it.

Approvals are stored per project, story and variant in the `approvals` table.

## Consequences

### Positive

- Baselines are deterministic and easy to explain: the merge base, or its nearest ancestor.
- Re-pushes and merges do not ask for the same review twice.
- The rules are pure, so they get the heaviest coverage, including property-based tests.

### Negative

- No per-branch baseline ancestry: a long-lived branch always compares against its merge base.
- A hash pair approval is global to the project, so an identical change on another branch is
  approved without a second look.
- The CLI sends only 100 first-parent ancestors, so the fallback search is bounded.

## Alternatives considered

- **Chromatic-style per-branch baseline ancestry.** Deferred as a v1 non-goal for simplicity.
