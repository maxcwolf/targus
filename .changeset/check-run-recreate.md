---
'@targus/core': minor
'@targus/cli': patch
---

Say why a build has no check run. `SubmitResultsResponse` gains `checkRunMissing`
(`no_installation`, `no_github_app` or `failed`, null when there is a check run; it defaults to
null so an older server's response still parses), and `targus run` prints
`check run not created: GitHub failed; the next review of this build creates it` instead of
claiming the project has no GitHub App installation. The server now creates a check run that
failed at submit time on the next review or approve-all.
