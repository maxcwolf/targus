---
'@targus/core': minor
---

`@targus/core`: the builds list pages. `ListBuildsQuery` takes an optional `limit` (1 to
`maxBuildsPageLimit`, default `defaultBuildsPageLimit`) and an opaque `cursor`, and
`ListBuildsResponse` adds `nextCursor`, null on the last page. A request with neither reads the
newest page as before, and a body without `nextCursor` still parses (as null).
