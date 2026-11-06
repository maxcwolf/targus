---
'@targus/cli': minor
---

`targus run` no longer hides git failures. It stops on a shallow clone (set `fetch-depth: 0` on
`actions/checkout`) instead of publishing a build where every story is new, fetches the base
branch into `origin/<base>` even in single-branch clones, and reports a failed fetch: a warning
when the base branch exists locally, an error when it does not. Not a repository, git missing or
an unknown revision are errors, not an empty merge base.
