---
'@targus/core': minor
---

Core gains the story history contract: `GetStoryHistoryQuery` (`storyId`, `variant`, `platform`,
`limit`), `StoryHistoryEntry` (a snapshot with its build) and `GetStoryHistoryResponse`, with
`defaultStoryHistoryLimit` and `maxStoryHistoryLimit`. `GET /api/projects/:id/history` answers
with the builds in which a story was anything but unchanged, newest first.
