# 0011. GitHub login with cookie sessions and org-membership authorization

## Status

accepted

## Date

2026-11-04

## Context

Reviewers sign in with GitHub (ADR 0001, plan.md section 5.2). The review routes, the image
download and the approve/deny actions need a principal the API can authorize against a
project's org (ADR 0007). The CLI keeps using project tokens, and both the CLI and the browser
read builds and images.

## Decision

- **Login** uses the targus GitHub App's OAuth flow (`GET /api/auth/github` →
  `/api/auth/github/callback`). The API exchanges the code, reads `GET /user`, upserts a `users`
  row keyed by GitHub id, and creates a `sessions` row that expires after 30 days.
- **The session** is the session id in a signed, HttpOnly, `SameSite=Lax` cookie
  (`targus_session`, HMAC with `SESSION_SECRET`). `SameSite=Lax` plus JSON bodies is the CSRF
  defence; there is no separate token. A signed short-lived cookie carries the OAuth `state`.
- **Authorization** is org membership: a reviewer may read and review a project when GitHub
  says they are a member of the project's org, asked through the App installation
  (`isOrgMember`) and cached per user and org for one hour in `org_memberships`. An org without
  an installation cannot be checked, so nobody can review it. A non-member gets 403.
- **Two kinds of principal** reach the read routes: a project token (the CLI) or a session (the
  browser). `GET /api/builds/:id`, `/snapshots` and `GET /api/images/:hash` accept either;
  writes stay single-principal (project token for CLI routes, session for review routes).
- **Images** are content-addressed and global, so a reviewer may read a hash only when a
  snapshot of a build of a project they can access references it; otherwise 404, never 403, so
  an unknown hash and a foreign one look the same.
- **GitHub origins are configuration** (`GITHUB_OAUTH_ORIGIN`, `GITHUB_API_ORIGIN`) so the e2e
  suite and local development can point the Worker at a stub (`e2e/support/github-stub.ts`)
  that answers the OAuth round trip, installation tokens, membership and check runs.

## Consequences

- No local login without a GitHub App or the stub; the API README documents both.
- Membership changes take up to an hour to apply; logging out does not clear the cache.
- A denied snapshot withdraws the carry-forward approval row (ADR 0004 rule 3), so a later
  build with the same hash pair is pending again rather than silently approved.

## Alternatives considered

- **Personal access tokens or basic auth**: no org check, secrets in the browser.
- **JWT sessions without a table**: cannot be revoked on logout; D1 rows are cheap.
- **Build-scoped image URLs** (`/api/builds/:id/images/:hash`): simpler authorization but every
  image request would read the build's snapshots; three hash indexes make the global route cheap.
- **A dev-login backdoor for local use**: a production code path that must never ship; a stub
  behind the origin vars exercises the real code instead.
