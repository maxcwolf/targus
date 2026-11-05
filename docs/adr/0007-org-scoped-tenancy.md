# 0007. Org-scoped tenancy from day one

## Status

accepted

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
