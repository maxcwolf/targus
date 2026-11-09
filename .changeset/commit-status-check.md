---
'@targus/core': minor
---

The build's check on GitHub is now a commit status, so clicking `targus/ios` or `targus/web` on a
pull request opens the build in the review UI. It was a check run, which opens GitHub's own page
first. The GitHub App needs the repository permission "Commit statuses: read and write" in place
of "Checks" (ADR 0040).
