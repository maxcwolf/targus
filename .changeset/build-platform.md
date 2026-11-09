---
'@targus/core': minor
---

Every build belongs to a platform (ADR 0036). Core gains the `Platform` contract (`ios`,
`android` or `web`) and `PixelRatio`; `CreateBuildRequest` takes an optional `platform`
(`ios` when absent, so existing CLIs keep opening iOS builds) and `pixelRatio` (`null` when
absent), and `Build` carries both. `GetLibraryResponse` adds `platform` and `platforms`, and
`GetLibraryQuery` takes the `platform` to read. `resolveBaseline(platform, shaOrder, candidates)`
only picks a build of the same platform; `checkRunName(platform)` names its check run
`targus/<platform>`; `displayPixelRatio(build)` falls back to 1 on web and 3 on a device.

Breaking for anyone implementing the ports: `BuildRepository.findLatestSuccessfulForShas` takes
the platform after the project id, and `GitHubClient.createCheckRun` takes the check run's name
after the target.
