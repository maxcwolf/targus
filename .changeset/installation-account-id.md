---
'@targus/core': minor
---

`@targus/core`: the `GitHubClient` port adds `installationAccountId(installationId)`, the numeric
id of the account an App installation belongs to. The API uses it to recognise the owner of a
personal account by GitHub account id instead of by login (ADR 0024). Implementations of the
port must add the method.
