# 0049. Members create projects through the App installation

## Status

accepted

## Date

2026-11-12

## Context

Until now a project was created only with `POST /api/admin/projects` and the `ADMIN_TOKEN`, which
one person holds. Every new team had to ask that person, and tell them the id of its GitHub App
installation. That does not work once teams outside the one that runs the service use it.

A reviewer is already known by their GitHub login, and access to a project already follows
membership of the GitHub account that owns its repository (ADR 0007). The App installation is
what connects targus to that account: it is created by someone GitHub allowed to install an App
there, and its token lists exactly the repositories that person gave the App.

## Decision

A signed-in reviewer creates a project for a repository that an installation of the targus GitHub
App can see, when they are a member of the installation's account.

- Three session routes under `/api/installations`: list the accounts, list an installation's
  repositories, and create a project for one of them. The route is the same use-case as the admin
  route (`createProject`), so the token, the org row and the conflict on a second project for a
  repository are the same.
- Nothing about an installation is stored before a project exists. Each request asks GitHub, as
  the App, for the installation's account (`GET /app/installations/:id`) and checks the reviewer
  against it the way project access does: the same account id for a personal account, org
  membership otherwise. An installation id is therefore not a secret: knowing one gives nothing
  to a reviewer who is not in its account.
- The repository must be in the installation's own list (`GET /installation/repositories`), so a
  project cannot be created for a repository the App was not given. The project's name is the
  repository's name and its default branch is GitHub's.
- The new org row records the installation id and the account id at once, so check runs and
  membership work from the first build.
- `GET /api/installations` lists the installations of orgs the reviewer already has a project
  under, plus the App's install link (`GITHUB_APP_SLUG`). A first-time team has none listed; it
  arrives from GitHub's Setup URL, `/setup?installation_id=`, which the review UI forwards to
  "New project" on that installation.
- Any member may create a project, not only an owner or the person who installed the App.
- The admin route stays, for scripted setup and for an org with no installation.

## Consequences

### Positive

- A team sets itself up: install the App, pick a repository, copy the token. Nobody holds a
  shared secret.
- No schema change and no stored installation state to keep in step with GitHub.
- The `GitHubClient` port gains two read methods; the no-op client answers "no installation".

### Negative

- Two or three GitHub calls for each of these requests. They are made a few times in a project's
  life.
- Someone who installed the App earlier and lost the redirect has no account listed until a first
  project exists; they get back by opening the App's install page again, which redirects when
  "Redirect on update" is set on the App.
- At most 1000 repositories of an installation are listed (ten pages of 100).
- Any member can create a project and so mint a token for a repository of their org. There is no
  way yet to revoke a token or delete a project from the UI.
- Creating projects is not limited or billed. A hosted service needs a plan check here later.

## Alternatives considered

- **Store installations from GitHub's webhooks.** Complete and fast to list, but it needs a
  webhook endpoint, a secret and a table that can drift from GitHub.
- **List the user's installations with their OAuth token** (`GET /user/installations`). Session
  tokens are not kept after login, and keeping them would be a new secret to store.
- **Only org owners create projects.** Reading a member's role needs a further permission, and a
  reviewer who can approve changes is already trusted with the project.
