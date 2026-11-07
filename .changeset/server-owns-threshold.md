---
'@targus/core': minor
'@targus/cli': minor
---

One diff threshold for the CLI and the server, so every story stored as changed has a diff
image. Core exports `defaultThreshold` (0.001); `CreateBuildResponse` now carries the
`threshold` the server classifies with, and `SubmitResultsRequest` requires the `threshold` the
results were diffed with. `targus run` diffs with the server's threshold and no longer accepts
`--threshold` (passing it is an error); `targus compare` keeps the flag. Upgrade the CLI and the
API together: each rejects the other's previous version.
