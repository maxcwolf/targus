---
'@targus/core': minor
---

Core gains `ReviewSnapshotsRequest` (`decision`, `snapshotIds`, at most `maxReviewSnapshots`) and
`ReviewSnapshotsResponse`, the contract of `POST /api/builds/:id/review`: one decision on several
snapshots of a build, such as every unreviewed story of a component.
