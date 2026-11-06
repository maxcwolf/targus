# 0019. Web features meet only through their index.ts

## Status

accepted

## Date

2026-11-06

## Context

`apps/web/src/` is split into `features/<name>/` (pages with their components, hooks and
tests), `api-client/` (all data access), `components/` (presentational pieces) and `app/` (the
router, the query client and the root layout). Engineering standards 1.2 says a feature owns its
components, hooks and tests, but nothing enforced it: dependency-cruiser checked only that data
comes through `api-client/index.ts` and that `components/` stays presentational.

A review of the imports on 2026-11-06 found 21 imports from one feature into another feature's
files, and 13 from `app/` into feature files:

| From | Into |
| --- | --- |
| `auth/AuthGate.tsx` | `errors/ErrorView.tsx` |
| `errors/ErrorView.tsx` | `auth/SignIn.tsx`, `auth/useMe.ts` |
| `build/BuildPage.tsx`, `projects/BuildsPage.tsx`, `projects/ProjectsPage.tsx`, `library/LibraryPage.tsx`, `snapshot/SnapshotPage.tsx` | `errors/ErrorView.tsx` |
| `build/useBuildData.ts`, `library/LibraryPage.tsx`, `shell/useProjectContext.ts` | `projects/useProjects.ts` |
| `library/stories.ts`, `library/LibrarySidebar.tsx`, `library/StoryGrid.tsx` | `build/filters.ts` |
| `snapshot/SnapshotBar.tsx`, `SnapshotPage.tsx`, `SnapshotSidebar.tsx`, `useSnapshotReview.ts` | `build/filters.ts` |
| `snapshot/SnapshotPage.tsx` | `build/useBuildData.ts` |
| `snapshot/useReview.ts` | `build/cache.ts` |
| `library/StoryCanvas.tsx` | `snapshot/useHotkeys.ts` |
| `app/RootLayout.tsx` | five files in `auth/` and `shell/` |
| `app/router.tsx` | eight files in `build/`, `errors/`, `library/`, `projects/`, `snapshot/` |

The features formed one cycle: `auth` imported `errors` (the gate shows `ErrorView` when the
session request fails) and `errors` imported `auth` (`ErrorView` shows the sign-in panel when the
error means "signed out"). No single module was in a cycle, so `no-circular` did not see it.

Some pieces are shared by nature: every page shows `ErrorView`, the error view needs the sign-in
panel, three features read the project list, and the snapshot page is a drill-in of the build
page and reuses its filters and data hook.

## Decision

We will give each feature a public entry, `features/<name>/index.ts`, and allow a feature to be
reached from anywhere else only through it. dependency-cruiser enforces three rules:

- `web-features-through-index`: a file in `features/<a>/` may import `features/<b>/` only through
  `features/<b>/index.ts`. Files inside one feature import each other directly.
- `web-app-uses-feature-index`: `app/`, `main.tsx` and `test/` reach a feature only through its
  `index.ts`.
- `web-feature-index-exports-own-files`: a feature's `index.ts` re-exports only files of that
  feature, so an index is never a hub that ties features together.

An index exports only what another feature or `app/` uses today; anything else stays private.

The shared-by-nature pieces stay features, at the bottom of the feature graph:

- `auth` (signing in, the session, the user menu) imports no other feature.
- `errors` (`ErrorView`, `NotFound`, `RouteCrash`) imports only `auth`.
- `shell` (the icon rail and the current-project context) imports only `projects`.
- `AuthGate` moves from `features/auth/` to `app/`. It composes `auth` and `errors` around every
  page, which is the shell's job, and moving it removes the `auth` <-> `errors` cycle.

The feature graph is now `library -> snapshot -> build -> projects -> errors -> auth`, plus
`library -> build`, `library -> projects`, `library -> errors`, `snapshot -> errors`,
`build -> errors` and `shell -> projects`. It has no cycle.

## Consequences

### Positive

- A feature's public surface is one file. Changing anything not exported from it cannot break
  another feature.
- Because other features import a barrel that re-exports the feature's page, a new cycle between
  two features almost always becomes a module cycle, which `no-circular` rejects. A probe that put
  the old `auth` -> `errors` import back behind `auth/index.ts` failed `yarn depcruise` that way.
- No code moved between features and no test changed: the churn is seven small index files, one
  moved component and rewritten import paths.

### Negative

- The rule does not forbid a cycle between features by itself. A cycle in which neither index
  reaches the importing file would pass. dependency-cruiser's folder-scoped `circular` check
  would catch it, but in this repo it reports every feature as cyclic, because each feature's
  tests import `test/render.tsx`, which imports `app/`, which imports every feature. We accept the
  gap; a reviewer checks the graph in the Decision when a feature gains a new dependency.
- An import of a feature's index loads the whole feature module graph (the library page imports
  `snapshot/index.ts` for `useHotkeys` and so also loads the snapshot page). Vite bundles one app
  either way, so this costs nothing at runtime today.
- `build/index.ts` exports filter helpers that the library and snapshot features use. If those
  helpers grow, they may deserve their own module outside `features/`.

## Alternatives considered

- **No imports between features at all; shared pieces move to `components/` or a shared
  module.** The cleanest graph, and cycles become impossible. But almost everything shared here
  loads data or uses the session (`ErrorView`, `useProjects`, `useBuildData`, `applyBuildUpdate`),
  so it cannot live in `components/`, which may not import `api-client/`. It would need a new
  `shared/` layer holding half of `build/`, `projects/`, `auth/` and `errors/`, which contradicts
  "a feature owns its hooks" and is the most churn.
- **Merge `errors` into `auth`.** Removes the cycle, but every page would import the auth feature
  to show a 404, and the two concerns are separate.
- **An explicit layer order of features in dependency-cruiser.** Guarantees a DAG, but every new
  feature needs a rule edit and the order has to be kept in sync by hand. The index rule plus
  `no-circular` covers the realistic cases with no upkeep.
- **Folder-scoped `no-circular` for `features/`.** See Negative: the test helpers make every
  feature folder part of a cycle, and the folder scope cannot exclude test files.
