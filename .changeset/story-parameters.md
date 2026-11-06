---
'@targus/core': minor
'@targus/cli': minor
'@targus/react-native': minor
---

`parameters.targus.delay` and `parameters.targus.skip` now work (ADR 0022). `withTargus` reports
each story's `parameters.targus` as a `targus/storyParameters` channel event once the story has
committed. The CLI validates it with core's new `StoryParameters` schema (`delay` from 0 to
`maxStoryDelayMs`, 10 000; `skip` a boolean) and records an invalid value as a story error. A
`skip` story is not captured, not submitted and not counted as removed; it is listed under
`skipped` in the capture manifest and in the `targus capture` and `targus run` summaries. A
`delay` replaces `--settle` for that story. `StorySelection`'s `rendered` case gains optional
`parameters`, and `CaptureReport` gains `skipped`. `TargusEmit` is now an overload for the two
targus events, and `TargusStoryContext` takes the story's `parameters`.
