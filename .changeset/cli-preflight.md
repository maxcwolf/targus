---
'@targus/core': minor
'@targus/cli': minor
---

`targus run` checks the token, the project and `--app` before the git work and the simulator, so a
first run with a wrong or revoked `TARGUS_TOKEN`, a deleted project or a bad app path fails in
seconds rather than after the capture. It asks the new `GET /api/projects/current` (core adds its
`CurrentProjectResponse` contract and `ProjectSummary` moves beside the other project schemas),
prints `project: <name> (<owner/repo>)`, and exits `3` naming `TARGUS_TOKEN` when the API rejects
the token. `--app` must be a directory with an `Info.plist` holding a bundle id; the id is read
once and handed to the capture. `TargusApi` gains `currentProject()`, and `TargusApiClient` no
longer strips trailing slashes from `baseUrl`, which `targus run` already normalizes.
