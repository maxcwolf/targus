---
'@targus/cli': minor
'@targus/core': minor
---

Capture web Storybooks: `targus capture` and `targus run` take `--platform web` with
`--storybook <dir or url>`, render each story in headless Chromium through the optional
`playwright-core` peer dependency, and crop it to the story's root (`--viewport`,
`--pixel-ratio`). Stories written for Chromatic work unchanged: without `parameters.targus`,
`parameters.chromatic` `disable`, `disableSnapshot` and `delay` are honoured
(`parseCaptureParameters` in core). An optional `targus.config.json` names the platforms a project
captures, so `targus run` publishes an iOS build, a web build or both, and `--platform` picks
some of them.
