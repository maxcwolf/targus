---
'@targus/core': minor
---

`ApproveAllResponse` adds `skippedCount`: the changes that were pending when an approve-all
started but were decided by another review before it committed, which approve-all leaves as
that review decided them.
