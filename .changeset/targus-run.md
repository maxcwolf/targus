---
'@targus/cli': minor
---

Add `targus run`: capture (or `--from-capture <dir>`), open a build on the targus API with git
metadata and CI context, diff against the baselines locally, upload missing and diff images,
submit the results and print the review URL and check run id. The token comes only from
`TARGUS_TOKEN`; an auth failure exits 3. Adds a hidden `fixture-capture` command and the
`fixture:capture` script for end-to-end tests.
