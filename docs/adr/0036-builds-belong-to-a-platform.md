# 0036. Builds belong to a platform

## Status

accepted

## Date

2026-11-08

## Context

targus is to review a project's web Storybook as well as its on-device one
([web-plan.md](../web-plan.md)). Both consumers in view, wolf-ui and the pilot app, build one set
of stories two ways: on device through `@storybook/react-native`, and in the browser through
`@storybook/react-native-web-vite`. They run the two captures in different CI jobs (a macOS
runner with a simulator, a Linux runner with a browser), so one commit gets two builds.

Nothing in a build says which platform it is for:

- The baseline is the newest successful build of the project at the nearest ancestor commit
  (`resolveBaseline` in core; `findLatestSuccessfulForShas` in `build.repository.ts`). A web
  build would take an iOS build at the same commit as its baseline, and every story would come
  out changed.
- The library reads the newest accepted build on the default branch
  (`findLatestBaselineOnBranch`), so it would flip between platforms.
- Every check run is named `targus/ios` (`checkRunName` in `github-client.adapter.ts`), so both
  builds of a commit would report under the same name.
- The review UI's actual-size view assumes 3x captures.

ADR 0006 limited v1 to iOS and reserved the `variant` key for other configurations. A variant
cannot carry the platform: the baseline is chosen per build, before any variant is looked at.

## Decision

We will give every build a platform. Core defines `Platform` as `ios`, `android` or `web`.
`CreateBuildRequest` carries `platform`, defaulting to `ios` so CLIs that predate it keep
working, and a migration adds `builds.platform` (not null, default `ios`) together with
`builds.pixel_ratio`.

- Baseline resolution, in core and in both SQL queries, considers only builds of the same
  platform.
- Opening a build with a known idempotency key and a different platform is a `conflict`, like any
  other difference (ADR 0027).
- The check run is named `targus/<platform>`; iOS keeps `targus/ios`.
- The library takes a platform (`GET /api/projects/:id/library?platform=`). Without one it
  shows the first, in ios, android, web order, of the platforms with a signed-off build on the
  default branch, and it lists those platforms, so the UI offers a switch when there are two or
  more. The UI shows the platform on builds.
- The UI's actual-size view divides by the build's pixel ratio. A build without one, as every
  build before this ADR, is taken as 1 on web and 3 on a device (`displayPixelRatio` in core).

Approvals are not keyed by platform. They are keyed by story, variant and hash pair, and an image
hash from one platform never equals one from another.

One project holds every platform of a Storybook. ADR 0006 is amended by this ADR: v1 captures
iOS only, but the data model no longer assumes it.

## Consequences

### Positive

- An iOS build and a web build of one commit each have their own baseline, check run and review,
  in one project with one token.
- The library can show a story on every platform, and later side by side.
- Android slots in the same way, with no further schema change.
- iOS builds, their baselines and the `targus/ios` check-run name do not change, and a CLI that
  sends no platform opens an iOS build.

### Negative

- One more column on every baseline query. It gets no index: `builds_project_sha_idx` (project,
  sha, created_at) already narrows the baseline lookup to the few builds of a project at each
  candidate sha. The library now reads twice (its platforms, then the newest build of one), and
  each read narrows by project through the same index, as its one read did before, so D1 row
  reads grow little (ADR 0002). An index on (project, branch, platform) can follow if one
  project's builds grow large enough to show in the reads.
- The 100% view of an iOS build now shows its captures at point size, a third of their pixels
  each way, where it showed one image pixel per CSS pixel before.
- A project whose web and iOS Storybooks name their stories differently gets two libraries that
  do not line up. That is the consumer's choice, and nothing breaks.
- Branch protection must require each platform's check separately.

## Alternatives considered

- **One project per platform.** Needs only a configurable check-run name, and no migration. Not
  chosen: the library and the review queue split in two, a team manages two tokens, and a
  cross-platform view of a story becomes a cross-project query.
- **The platform in the `variant` key.** Not possible on its own: the baseline build is chosen
  before variants are compared, so a web build would still pick an iOS baseline build.
- **One build holding both platforms.** Would need both captures in one CI job, which a macOS
  simulator job and a Linux browser job cannot share without moving one of them.
