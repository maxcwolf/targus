---
'@targus/core': minor
'@targus/cli': patch
---

`diffImages` diffs images of different sizes on a padded canvas instead of reporting them as
100% changed. Both images are anchored top left on a canvas as wide as the wider and as tall as
the taller; pixels only one image covers count as changed, and the ratio is over the canvas. The
result always carries a diff image (`diffPng` is no longer nullable) and keeps `sizeMismatch`.
`targus compare` and `targus run` now report a story that grew by a few pixels as a small change
with a diff image.
