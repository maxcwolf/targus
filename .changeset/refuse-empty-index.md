---
'@targus/cli': patch
'@targus/core': patch
---

`targus run` refuses a capture with no stories before it opens a build, saying the story index
was empty (check the `stories` glob, the Storybook build and `--filter`) or that every story was
skipped by `parameters.targus.skip`. `SubmitResultsRequest` now needs at least one result, so the
API answers 400 to an empty submission instead of marking every baseline story removed and
passing the check.
