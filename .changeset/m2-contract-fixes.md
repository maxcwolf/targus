---
'@targus/core': patch
'@targus/cli': minor
---

`@targus/core`: `compareSnapshot` takes `current.imageHash: ImageHash | null` (null for an errored
capture), `Build` gains `checkRunId: number | null`, `BuildStatusSummary.status` gains
`in_progress`, and `baselineBuildStatuses` (`['passed', 'accepted']`) is exported and used by
`resolveBaseline`. `@targus/cli`: `targus run --sha <sha>` overrides `git rev-parse HEAD` (needed on
GitHub Actions `pull_request` events, whose `HEAD` is a synthetic merge commit), and `run` prints
the build id on its own `build: <id>` line.
