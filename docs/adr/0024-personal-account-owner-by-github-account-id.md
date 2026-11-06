# 0024. The owner of a personal account is recognised by GitHub account id

## Status

accepted

## Date

2026-11-06

## Context

ADR 0012 lets a project's `githubOrg` name a personal account and makes the account's owner its
one member, because GitHub has no members endpoint for a user. It recognised the owner by
comparing the reviewer's login with `orgs.github_org`. A GitHub login is not a stable identity:
an account can be renamed, and the freed login can then be registered by someone else, who
would have been let into every project of the old account.

GitHub's numeric account id never changes and is never reused. Two places already know it:
`users.github_id` holds the reviewer's, stored at sign-in from `GET /user`; and the App
installation of the project's org belongs to exactly one account, which
`GET /app/installations/{installation_id}` (authenticated as the App, with its JWT) names by id.
The `orgs` row stored only the login and the installation id.

## Decision

We recognise the owner of a personal account by account id: access is granted without a
membership check when the reviewer's `githubId` equals the account id of the org's
installation. No access decision compares logins.

- `orgs` gets a nullable `github_account_id` (migration 0006). Rows are not backfilled from
  `github_org`, since a login is exactly what cannot be trusted.
- The id is read lazily: when an access check finds it null, the API asks GitHub through the
  installation (`GitHubClient.installationAccountId`, a new port method) and stores it, so each
  org costs one extra GitHub call in its lifetime. The store applies only while the org is still
  on the installation the id was read from.
- Setting a different installation on an org (the admin create-project route) clears the stored
  id, which belonged to the old installation; the next check reads it again.
- While the id is unknown and cannot be read (GitHub failing, installation gone, no App
  configured), the org grants nobody anything, members included, and the request's log line
  gets an `org_account_unknown` warning naming the org and the reason (ADR 0020).
- The id comparison runs before the membership cache and the membership check, as the login
  comparison did. Org and user ids share one id space, so a user id never equals an org's.

The rule lives in `apps/api/src/services/access.service.ts`. Everything else in ADR 0012 holds:
the installation requirement, and every other reviewer going through the org membership check.

## Consequences

### Positive

- An owner who renames their account keeps access with no change to the org row.
- Someone who registers a freed login gets nothing of the old account's projects.
- Orgs created before migration 0006 need no manual step; the first access check fills them in.

### Negative

- A new GitHub call per org, once, authenticated as the App rather than as the installation.
  If it fails, the org is closed to everyone, members included, until a later check succeeds.
- `GitHubClient` grows a method, which every implementation of the port must add.
- Membership checks still pass the reviewer's login to GitHub, as its API requires; that login
  is the one stored at the reviewer's last sign-in.

## Alternatives considered

- **Backfill the id in the migration from `github_org`** (`GET /users/{login}`): trusts the
  login at migration time, which is the identity this change stops trusting.
- **Read the id when the project is created**: needs the App at admin time and leaves existing
  rows unfilled; the lazy read covers both.
- **Re-read the account on every check** (ADR 0012's "ask the installation for its account
  type"): one GitHub call per check for an answer that does not change.
