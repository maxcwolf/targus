# 0007. Org-scoped tenancy from day one

## Status

accepted, amended by [0011](0011-github-login-sessions-and-org-authorization.md),
[0012](0012-personal-accounts-as-single-member-orgs.md) and
[0014](0014-upload-record-grants-image-access.md)

## Amended by

The org-scoped data model still holds. These parts of the text below were overtaken:

- **Login and the membership cache**
  ([ADR 0011](0011-github-login-sessions-and-org-authorization.md)). Membership is not checked
  at login and not cached in the session. The session is a `sessions` row named by a signed
  cookie. Org membership is asked through the App installation when a reviewer reaches a
  project, and cached per user and org for one hour in `org_memberships`. An org row without
  an installation can be reviewed by nobody.
- **What an org is** ([ADR 0012](0012-personal-accounts-as-single-member-orgs.md)).
  `github_org` may name a personal account, whose owner is its one member.
- **"Every other table hangs off `org_id`"**
  ([ADR 0014](0014-upload-record-grants-image-access.md)). `images` is shared by every project
  and has no org column. A project's access to an image is the upload record in
  `project_images`. `users`, `sessions` and `org_memberships` belong to a user, not an org.

Two details were changed without an ADR and are recorded here. The org row is created with the
org's first project by `POST /api/admin/projects`, not seeded separately. And project tokens
are created through that admin API call, not by a `targus admin create-project` command
(plan.md section 12).

Since PR #24 (commit 40e16aa, 2026-11-06, no ADR of its own), the API does not mint an
installation access token per request: `apps/api/src/adapters/installation-token-cache.ts`
keeps one per installation in memory for the life of the isolate and reuses it until five
minutes before it expires.

## Date

2026-11-04

## Context

The first consumer is `example-org/example-app`. targus should serve any repo in the example-org org
now and other GitHub orgs later without a rewrite. Adding tenancy to a single-tenant schema
after the fact means touching every table and query.

## Decision

We will scope the data model by org from day one. The `orgs` table holds `github_org` and
`installation_id`; every other table hangs off `org_id` through `projects`, and every query is
scoped by it. Only example-org is installed in v1, seeded manually; the `installation.created`
webhook that creates an org row is a v1.1 candidate.

One GitHub App ("targus") handles both identity and reporting. Login uses the App's OAuth
flow; the session is a signed HttpOnly cookie, and on login the API checks the user is a member
of the project's org and caches that in the session for an hour. Check runs use an
installation access token minted per request from the App's private key, stored as a Worker
secret.

Marked as an assumption in plan.md: project tokens are created by a maintainer with
`targus admin create-project`, not through a UI.

## Consequences

### Positive

- A second org becomes a configuration change rather than a migration.
- One App gives login, org membership and check runs with a single installation.
- Authorization tests (member, non-member, no session) cover the boundary explicitly.

### Negative

- Every query carries an org scope even while there is only one org.
- Org onboarding is manual until the v1.1 webhook lands.
- Membership is cached for an hour, so a removed member keeps access until it expires.

## Alternatives considered

- **Single-tenant schema for example-org only.** Simpler now, but a second org would require a
  rewrite, which the goal rules out.
- **Separate OAuth app for login.** Not chosen; the GitHub App already provides OAuth.
