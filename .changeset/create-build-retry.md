---
'@targus/core': patch
'@targus/cli': patch
---

`targus run` now retries opening its build like every other API request, so a network blip or a
lost response at that moment no longer fails the run after the capture. Each run sends one
`idempotencyKey` with every attempt (a new optional field of core's `CreateBuildRequest`), and the
API answers a repeated key with the build the first attempt opened instead of opening a second
one; the same key with a different build is a 409 `conflict`. A request without a key is sent
once and opens a new build, as before.
