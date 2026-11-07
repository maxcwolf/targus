---
'@targus/core': minor
'@targus/cli': patch
---

Tell a check run still being created from one GitHub failed to create. `CheckRunMissing` gains
`pending`, which the server answers when a resent results submission arrives while an earlier
attempt (or a review) is still creating the build's check run, and `targus run` prints
`check run: still being created by an earlier attempt or a review` instead of saying GitHub
failed. When GitHub did fail on a build with nothing to review, `targus run` now says to run
`targus run` again rather than promising that the next review creates it, and a 409 on a retried
results submission says the build already has different results instead of suggesting the
earlier attempt succeeded.
