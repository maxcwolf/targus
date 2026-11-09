# 0040. The build's check is a commit status

## Status

accepted

## Date

2026-11-09

## Context

A build reports to GitHub so that a pull request can require it (plan.md section 5.2). Until now
it did so with a check run created through the GitHub App, and the check run's `details_url`
pointed at the build in the review UI.

On a pull request GitHub does not link a check run to its `details_url`. The row for
`targus/ios` opens GitHub's own page for the check run, and the review UI is one more click away,
behind "View more details on <app>". Seen on the proof of concept on 2026-11-09. A commit status
is different: its row links straight to its `target_url`. Chromatic reports commit statuses, so
the people targus is built for expect one click from the pull request to the review.

A commit status has less than a check run: a state (`pending`, `success`, `failure`, `error`),
a description of at most 140 characters, a context and a link. It has no title, no long summary
and no page on GitHub. A status is not edited; a new status with the same context on the same
commit replaces the one GitHub shows.

## Decision

We will report a build's check as a commit status, not as a check run.

- The context is `checkRunName(platform)`: `targus/ios`, `targus/web`, as before.
- `target_url` is the build's page in the review UI.
- `in_progress` is reported as `pending`; a completed check as `success` or `failure`. The
  description is the summary line the check run had ("2 changes awaiting review"), cut to 140
  characters.
- An update posts the status again with the same context and link.
- The GitHub App needs the repository permission **Commit statuses: read and write**. It no
  longer needs **Checks**.

The `GitHubClient` port keeps its two operations, `createCheckRun` and `updateCheckRun`; the
second now takes the name and the link, because a status is replaced whole. The services, the
`check_run_id` column, the claim on creating the check (ADR 0026) and the `checkRun` fields of the
API contract are unchanged. The stored id is now the id of the build's first status, and still
means "this build has its check on GitHub".

## Consequences

### Positive

- Clicking the check on a pull request opens the build in the review UI, as Chromatic's does.
- Branch protection is unchanged: a required status with the same name blocks while `pending`.
- No wire or schema change: an older CLI works against the new service.

### Negative

- The check has no page on GitHub and no title; the description is all GitHub shows.
- Every installation has to accept the new permission before its builds get a check. Until then
  GitHub answers 403, which is logged as `check_run_create_failed`, and the CLI reports that the
  check was not created.
- A build reviewed across the deploy keeps its old check run as it was and gains a status beside
  it. Old check runs are not cleaned up.
- The code still says "check run" for what is now a commit status. Renaming the column, the
  contract fields and the CLI's output is left for a separate, mechanical change, because the
  contract part of it is a breaking change for the CLI.
- Creating a status is idempotent, so the claim that stops two requests creating two check runs
  now guards nothing harmful. It is kept because it also decides who follows newer reviews.

## Alternatives considered

- **Keep the check run and put the link first in its summary.** Still two clicks, and the first
  lands on a GitHub page that looks like the end of the road.
- **Report both.** Two rows per platform on every pull request, with the same name and
  different links.
- **A check run with a "Review" action button.** The button is on the same GitHub page the
  reviewer should not have to visit, and needs a webhook endpoint.
