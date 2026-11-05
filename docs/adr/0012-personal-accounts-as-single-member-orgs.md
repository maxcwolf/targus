# 0012. Personal accounts as single-member orgs

## Status

accepted

## Date

2026-11-05

## Context

ADR 0007 scopes everything by GitHub org and ADR 0011 authorizes a reviewer by org membership,
asked through `GET /orgs/{org}/members/{username}`. The proof of concept before the pilot app runs on a
repository owned by a personal account (`maxcwolf`). A GitHub App installs on a personal account
exactly as on an org, and check runs work unchanged, but there is no members endpoint for a
user: the membership call answers 404, so the owner of the account could not review their own
project.

## Decision

A project's `githubOrg` may name a personal account. The account's owner is its one member: when
the reviewer's login equals `githubOrg` (case-insensitively, as GitHub compares logins) access
is granted without asking GitHub and without a cache row. Every other login goes through the
org membership check as before, which answers "not a member" for a personal account. The rule
lives in `apps/api/src/services/access.service.ts`.

The installation requirement of ADR 0011 stays: a project whose org row has no installation is
reviewable by nobody, the owner included.

## Consequences

- A personal repository can use targus end to end with no schema change; the `orgs` table keeps
  its name and holds accounts of either kind.
- Collaborators on a personal repository cannot review. Only the owner can, until a rule based
  on repository permission is added.
- Logins are unique across users and orgs, so the comparison cannot grant access to an org by
  accident; a user who renames their account loses access until the org row is updated.

## Alternatives considered

- **Repository collaborator permission** (`GET /repos/{owner}/{repo}/collaborators/{username}`):
  the more general rule, and the likely next step, but it needs a per-project cache and a
  decision about which permission level may approve. Not needed for a one-person proof of
  concept.
- **Ask the installation for its account type** and branch on `User`: one more GitHub call per
  check for the same answer the login comparison gives.
- **Run the proof of concept in a throwaway org**: avoids the change but leaves personal
  repositories unsupported.
