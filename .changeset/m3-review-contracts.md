---
'@targus/core': minor
'@targus/cli': minor
---

`@targus/core`: review contracts for the M3 web app (`MeResponse`, `ListProjectsResponse`,
`ListBuildsResponse`, `ReviewSnapshotResponse`, `ApproveAllResponse`, `SnapshotCounts`),
`Snapshot` and `StoryResult` carry the Storybook `title` and `name`, `GetBuildResponse` adds
`counts`, and `tallySnapshots` / `buildStatusFromTally` let a build's status be folded from
stored counts. `@targus/cli`: `targus run` reports each story's title and name, and
`writeFixtureCapture(dir, 'changed')` writes a variant with one changed story for tests.
