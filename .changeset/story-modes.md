---
'@targus/cli': minor
'@targus/core': minor
'@targus/react-native': minor
---

Capture story modes on the web: `parameters.targus.modes` (or Chromatic's `parameters.chromatic.modes`)
names sets of globals and an optional viewport, and a web capture takes one snapshot per mode,
each its own variant with its own baseline. Capture files and summaries name a mode's snapshot
`<story id>@<mode>`. `TargusParameters` gains the `modes` type; native captures ignore it for now.
