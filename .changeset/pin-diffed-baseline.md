---
'@targus/core': minor
'@targus/cli': minor
---

Each story result names the baseline it was diffed against, so a review of the baseline build
during a run can no longer turn a denied change into `unchanged`. `StoryResult` requires
`baselineHash` (null when the story had no baseline, and then `diffRatio` and `diffHash` must be
null), and core exports `pinnedDiff`, which keeps the CLI's diff only when that baseline is still
the story's baseline at submit. `targus run` sends the baseline `POST /api/builds` offered for
every story. Upgrade the CLI and the API together: the API refuses results without
`baselineHash`.
