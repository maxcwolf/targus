# 0046. Only the newest build of a commit sets its check

## Status

accepted

## Date

2026-11-09

## Context

Since ADR 0040 a build's check is a commit status. A status belongs to a commit and a context
(`targus/ios`), not to a build: every build of one platform on one commit writes the same row on
the pull request, and GitHub shows whichever status was posted last.

A commit can have more than one build of a platform, because a CI run can be run again. Each build
has its own snapshots and its own review. Seen on the proof of concept on 2026-11-09: a commit was
built twice for the web, a reviewer approved the first build, and the check turned green while the
second build had 79 changes awaiting review. With check runs this could not happen, because each
build had a check run of its own.

## Decision

A build sets its commit's check only while it is the newest build with results of its platform
on that commit.

- "Newest" is the highest build number in the project. "With results" is any status but
  `in_progress`: a build that is still capturing has nothing to show, so the build before it keeps
  the check until the results arrive.
- The rule is applied where the status is sent (`sendWhileNewest` in `services/check-run.ts`), so
  it covers the results, a review and the resend after a newer review (ADR 0026) alike.
- A newer build can get its results between the older build's look and its call to GitHub, and be
  written over. So after an older build has sent, it looks again, and when a newer build now has
  results it sends that build's state, from its stored tally, with that build's link.
- An older build that is reviewed is still reviewed: the decision and its approvals are stored as
  before. Only the status is left alone.
- When results arrive for a build that is already not the newest, no status is created and the
  response says `checkRunMissing: 'pending'`, the value that already means "another request has
  the check". No new value is added, so an older CLI reads the response.
- The builds port gains `findNewestCompletedForSha(projectId, platform, sha)`, implemented for D1,
  Postgres and the in-memory double and covered by the build contract suite.

## Consequences

### Positive

- The check on a pull request always describes the build a reviewer gets by running CI again,
  never an earlier one.
- No schema or wire change.

### Negative

- One more read before every status and one after it.
- A commit whose newest build nobody reviews stays `pending` even when an older build of it was
  approved: the newer build has to be reviewed.
- `pending` now has two meanings in `checkRunMissing`. The CLI's text for it says the check is
  being created, which is not quite true for an older build.
- The query has no index of its own; it reads the project's builds of one commit, which are few.

## Alternatives considered

- **A context per build** (`targus/ios #12`). Every run adds a row to the pull request, and a
  required status cannot name it.
- **Let the last review win.** What ADR 0040 did without saying so; it is the bug above.
- **Refuse to review an older build.** The review UI would have to explain it, and the approvals
  an older build records are still useful as baselines.
