# 0048. Unfinished features ship behind a flag

## Status

accepted

## Date

2026-11-12

## Context

targus is becoming a product with a first release whose scope is fixed: visual diff testing and
review for iOS, in a state fit for production. Other features are being built at the same time
(a hosted story library, web capture, self-serve projects, accessibility checks), in small pull
requests that each land on `main`. `main` is what gets deployed.

Without a switch, a feature is either held on a long branch until it is finished, or it is live
for every user the moment its first pull request merges. Neither fits small pull requests and a
release with a fixed scope.

## Decision

We will list every feature that can be turned on or off in one place, with a default, and let a
server change the defaults with one variable.

- `packages/core/src/features.ts` holds the names (`featureNames`), a summary and a default for
  each (`featureCatalog`). A feature that is not ready starts with `enabledByDefault: false`, so
  merging it changes nothing for a server that does not ask for it. When it is ready, its default
  becomes `true` in a pull request of its own; when nobody needs to turn it off any more, the flag
  and its checks are deleted.
- `FEATURES` on the API changes the defaults: `name=on` or `name=off`, comma-separated. It is
  read in `config.ts` like every other variable. An unknown name or setting fails at start; it is
  not skipped, because a typo would leave a feature in a state nobody chose.
- The API is where a flag is enforced. A route of a feature has `feature('<name>')` as its first
  middleware and answers 404 `not_found` while the feature is off, before authentication, as a
  route that does not exist.
- The review UI reads the flags from `GET /api/me` and asks `useFeature('<name>')`. A feature
  that is off has no link and its address shows the not-found page. This is for tidiness; hiding
  a link protects nothing.
- Flags are per server, not per project, org or user.
- The first flag is `library`, on by default, so nothing changes for a server that sets nothing.
- The CLI and the React Native helper have no flags. What they do is chosen by the person who
  runs them, in their own config.

## Consequences

### Positive

- An unfinished feature can merge in small pull requests and stay off in production.
- The scope of a release is one variable on the server, and one table in the API README says
  what can be switched.
- A flag is a typed name: removing one makes the compiler point at every check to delete.

### Negative

- Every flagged feature has two states to test, and its tests cover both.
- A flag that is never removed is clutter; nothing enforces removal.
- Changing a flag needs a deploy (a variable on the Worker), not a click.
- A name left in `FEATURES` after its flag is deleted stops the server at start.
- No per-customer switch: a feature cannot be given to one pilot org and not another yet. That
  needs flags stored with the org, which can sit on top of this catalog later.

## Alternatives considered

- **A flag service** (LaunchDarkly, PostHog, or a table with an admin page). Per-user rollout and
  instant changes, which a service with one pilot does not need, at the cost of a dependency in
  every request.
- **Long-lived branches.** No switch to maintain, but large merges and nothing to test in
  production before release.
- **Build-time flags in the web app.** The UI and the API could disagree, and the API would still
  serve the routes.
- **Skip unknown names in `FEATURES`.** Friendlier after a flag is removed, but it hides typos.
