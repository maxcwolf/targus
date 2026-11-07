---
'@targus/core': patch
---

`acceptedImageHash` returns the baseline for an `unstable` snapshot instead of its capture, so an
unstable capture never becomes the next build's baseline (and `libraryStories` shows the kept
image). An `unstable` story still never blocks the check (ADR 0030).
