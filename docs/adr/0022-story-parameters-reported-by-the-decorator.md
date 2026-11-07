# 0022. The decorator reports `parameters.targus` over the channel

## Status

accepted, amended 2026-11-06: the first run on a device showed that Storybook's channel
serialises with telejson, which sends `undefined` as the string `_undefined_`, so every story
without `parameters.targus` was rejected. The decorator now leaves `targus` out of the payload
when the story sets none, and the CLI decodes `_undefined_` before validating.

Amended again 2026-11-06: a story that threw could pass. The parameters reporter sat outside
the error boundary, so the app sent `targus/storyParameters` right after `targus/storyError`,
and when both reached the CLI before the selection read them the parameters replaced the
cached error, so the blank screen was captured. The CLI now never lets a non-error report
replace a cached error, and a new selection of a story drops its cached report unless
Storybook answers `storyUnchanged`. The decorator now puts the reporter inside the boundary,
so a story that throws while rendering sends only `targus/storyError`.

Amended again 2026-11-07: skipping single stories still never blocks the check, but a run that would
submit zero results is refused before any build is created. Submitting nothing would mark every
baseline story `removed`, which needs no review, so the check would pass and, on the default
branch, the empty build would become the next baseline. `targus run` exits 1 when the story index
is empty, when `--filter` matched nothing, or when every story is skipped, and the API answers
400 to a `POST /api/builds/:id/results` whose `results` list is empty.

## Date

2026-11-06

## Context

`@targus/react-native` typed `parameters.targus.delay` and `parameters.targus.skip`, but nothing
read them, so a story with a spinner or an entrance animation had no opt-out: it was captured
mid-motion and came out `unstable` or `changed` (docs/capture-spike.md: 16 of 354 the pilot app stories).

The CLI needs both values before it takes a story's first screenshot, and it is the CLI, on the
CI runner, that waits and screenshots. Two facts from Storybook RN 10.7 (read in its
`dist/index.js`) constrain where the values can come from:

- `RN_GET_INDEX` returns the story index that `prepareStories` builds. Its entries hold `id`,
  `title`, `name`, `importPath`, `type` and a fixed `tags: ['story']`. They carry no parameters.
- The RN `renderToCanvas` only calls React `setState` with the new story context and returns,
  and Storybook emits `storyRendered` right after it. So `storyRendered` reaches the CLI before
  React has rendered the story, and anything the story tree emits arrives after it. This also
  means a `targus/storyError` can arrive after `storyRendered`.

The decorator is the one place in the app that sees each story's merged parameters
(`context.parameters`), and it already talks to the CLI over the channel (ADR 0008).

## Decision

We will have the `withTargus` decorator report each story's raw `parameters.targus` in a
`targus/storyParameters` channel event `{ storyId, targus }`, from a `useEffect` of a wrapper
component inside the error boundary, so it fires once the story has committed. A render error is
reported from the error boundary's `componentDidCatch` instead, and the wrapper of a story that
throws never commits, so that story sends no parameters.

The CLI validates the value with core's `StoryParameters` zod schema: `delay` a number from 0 to
`maxStoryDelayMs` (10 000), `skip` a boolean, unknown keys ignored. An invalid value makes the
story an `error` naming the field; it is never replaced by a default. The app forwards the value
unvalidated so the bound lives in one place.

`WsStorybookChannel.selectStory` keeps waiting after `storyRendered` for the decorator's report
(`targus/storyParameters` or `targus/storyError`) for up to `reportGraceMs` (1 s), and returns
`rendered` with the parameters, or `error`. It remembers every report it sees, so a report that
lands in the same socket read as `storyRendered`, or one sent before the selection of a story
already on screen (`storyUnchanged`), is not lost. A remembered error is never replaced by a
later non-error report for the same story, whatever decorator version sent it, so an error
always fails the build (ADR 0004). Selecting a story again forgets its report, because the new
render reports afresh, unless Storybook answers `storyUnchanged`. An app without the decorator never reports:
after the first miss the channel stops waiting, and any later `targus/` event turns waiting back
on. If the app drops the channel during that wait, the selection answers nothing, like a render
wait, so the crash watch of ADR 0021 ends the run and `close()` rejects the wait; it never turns
into a `rendered` story when the grace runs out. `StorySelection`'s `rendered` case gains
optional `parameters` in the core port.

The capture loop applies them: `skip` returns before any wait or screenshot and lists the story
in `CaptureReport.skipped` (and the manifest's `summary.skipped`), not in `stories`; `delay`
replaces `--settle` as the first wait, and a stability retry doubles it as it doubles the settle.

A skipped story is not submitted to the API. The CLI does not count it as `removed` in its own
summary, `targus compare` does not list it as removed, and `targus run` prints it on a `skipped`
line. The server, which does not know about skips, records a baseline story that is now skipped
as `removed`. That state is informational and already approved (ADR 0004), so it is never a
visual change and never blocks the check. Teaching the server about skips is a contract change
left for later (see Consequences). A run with no story left to submit is refused instead (see the
2026-11-07 amendment).

## Consequences

### Positive

- A story can opt out of capture or ask for a longer settle without a CLI flag or a config file,
  next to the code that animates.
- A typo or an absurd delay is visible as a story error instead of being silently ignored.
- Waiting for the decorator's report also catches a render error that arrives after
  `storyRendered`, which the channel previously missed.
- Core and the CLI still do not import `@targus/react-native`; the event name and payload are a
  small wire contract in core.

### Negative

- The parameters work only with the decorator installed. Without it the first story costs one
  extra `reportGraceMs`, and `skip` and `delay` are ignored.
- A story is still selected and rendered before it can be skipped, so a story that crashes the
  app still crashes it.
- On the server a skipped baseline story is `removed`, which drops it from the next baseline, so
  un-skipping it later makes it `new` and asks for one review. Carrying the baseline forward needs
  `SubmitResultsRequest` to list skipped stories and the results service to keep their baseline
  entry; that is an API change outside this decision.
- Not verified on a device yet: the ordering above comes from reading Storybook RN 10.7's source
  and is covered by tests against a real websocket with a scripted app.

## Alternatives considered

- **Read parameters from the story index.** Simplest for the CLI (a filter where the story list
  is built), but `RN_GET_INDEX` entries carry no parameters, and adding them would mean patching
  Storybook RN or loading every story's CSF in the app at startup.
- **Apply the delay in the app.** The decorator could hold back rendering, but the CLI's settle
  and screenshots are timed from `storyRendered`, which Storybook emits before the decorator runs,
  so an in-app delay cannot move the screenshot. `skip` has to reach the CLI anyway.
- **Ask the app for every story's parameters up front** (a `targus/getParameters` request
  answered from Storybook's story store). It would allow filtering before selection, but it
  depends on Storybook's internal preview API, which the decorator deliberately does not import.
- **Read the report without waiting, during the settle.** The settle would have to start before
  `delay` is known, so `delay` could only add to `--settle`, and `skip` would still cost a settle.
- **Clamp an out-of-range delay.** Rejected in favour of an error: a clamp hides the mistake and
  makes the capture differ from what the story asked for.
