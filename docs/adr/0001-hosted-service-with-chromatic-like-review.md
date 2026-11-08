# 0001. Hosted service with a Chromatic-like review UI

## Status

accepted

## Date

2026-11-04

## Context

targus aims to be a Chromatic equivalent for the native Storybook of a React Native app. On
every pull request and every push to `main`, CI renders each story in an iOS simulator,
screenshots it, compares it with the accepted baseline and publishes the result as a GitHub
check. Engineers need to review each changed story side by side with its baseline and approve
or deny it, and the check must stay pending until every change is approved so the repo can
require it before merge. The first consumer is one team's Expo app (the pilot app).

Review needs state that outlives a CI job: baselines, approvals that carry across pushes, who
reviewed what, and image storage. It also needs a place for people to look at images and click
approve.

## Decision

We will build a hosted service with GitHub login and a review web app modelled on Chromatic's
review UX. One GitHub App ("targus") provides OAuth login and creates check runs. The web app
has a project page with a builds list, a build page with changes grouped by component, and a
snapshot page with side-by-side, diff overlay, slider and baseline/current views, plus keyboard
shortcuts for moving between changes and approving.

## Consequences

### Positive

- Reviewers get a purpose-built UI with diff overlays and bulk approval instead of reading
  images in CI artifacts.
- Approvals are stored centrally, so they carry forward across re-pushes and into `main`.
- The check run gives a single required gate in branch protection.

### Negative

- There is a backend to build, deploy, secure and keep within free-tier limits (see ADR 0002).
- Login, sessions and org-membership checks become our responsibility.
- The CLI's `capture` and `compare` commands stay useful offline, but the full review flow
  depends on the service being up.

## Alternatives considered

- **GitHub-only, no backend.** Store baselines in the repo or CI artifacts and report through
  check annotations or PR comments. Rejected because there is no good place to record
  approvals that carry forward, no side-by-side or overlay review, and no per-snapshot approve
  and deny flow that can hold a check pending until everything is reviewed.
