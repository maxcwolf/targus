# 0047. Play functions on a device go through the story's own handlers

## Status

accepted

## Date

2026-11-09

## Context

Stories use play functions to reach a state by interaction, and the pilot app has them in nine
story files (parity-plan.md). On the web Storybook runs them while rendering, and a web capture
already waits for them (web-plan.md); a run on the proof of concept on 2026-11-09 confirmed it.

On a device nothing ran them. The on-device Storybook (`@storybook/react-native` 10.7) removes
`play` from every story unless `reactNative: { playFn: true }` is set, and says the option is
"not yet fully supported on native". A spike on the proof of concept, the same day, found:

- With the option on, Storybook calls the play function, with no `canvas` and no `userEvent`.
- It calls it before React has rendered the story. The story before it is still mounted, so a
  search of "what is on screen" finds the old story.
- The story mounts, and `withTargus` reports its parameters, while the play function is still
  running. The CLI took that report as "the story is on screen" and would screenshot early.
- `storyRendered` is sent after the play function, and `storyRenderPhaseChanged` with
  `newPhase: 'playing'` before the story mounts. A play function that throws is reported as
  `playFunctionThrewException`, with the error and no story id, and no `storyRendered` follows.
- A capture may run with `Date` frozen, so a timeout read from the clock never fires.

## Decision

We will support play functions on a device with the option Storybook already has, a helper in
`@targus/react-native`, and a channel that waits for the play function.

- **`onDevice(context)`** gives a play function `press(name)` and `changeText(name, text)`. An
  action finds the element of its own story named by `accessibilityLabel`, `aria-label`,
  `testID` (or `placeholder`, for an input) and calls its `onPress` or `onChangeText`.
- **Finding the story.** `withTargus` wraps each story in a `StoryTree`, a class component that
  records itself by story id while mounted. An action waits for its story's `StoryTree`, then
  searches React's tree below it. The tree is reached through the instance's `_reactInternals`
  and read from the root's current copy, because an instance may point at the copy that is a
  render behind.
- **Waiting** is counted in 16 ms turns, not read from the clock.
- **The channel.** While a selection waits, `storyRenderPhaseChanged` to `playing` for its story
  means the decorator's parameters no longer answer it; only `storyRendered` or an error does.
  `playFunctionThrewException` answers the waiting selection with an error,
  `play function: <message>`, as the web capture words it.
- **No new protocol.** The app sends nothing new; the CLI reads two Storybook events it ignored.
  An app without `playFn` behaves as before.

## Consequences

### Positive

- A story reaches an interactive state on a device with the mechanism its authors know, and one
  story file can serve the web and the device with a branch on the platform.
- A failing play function fails the build, with its message, in the time it takes to fail.
- Nothing is added to the app's native side and no tool drives the simulator.

### Negative

- It is the handler that is called, not the screen that is touched. Gestures, scrolling, focus
  and the keyboard cannot be exercised, and a bug in how a native view delivers a touch is not
  seen.
- `changeText` only shows in a controlled input.
- `_reactInternals` and the shape of a fiber are React internals. A React release can change
  them; the package's tests, which run the helper against real React, are the alarm.
- It leans on a Storybook option its authors call unfinished, and on the order of three channel
  events found by experiment.
- A web play function runs on the device as soon as `playFn` is on, so every one needs a
  platform branch.

## Alternatives considered

- **Drive real touches from outside** (Maestro, idb, XCUITest). Real input, but a new tool on
  the runner, slower runs, and steps written apart from the story. Still the answer if gestures
  matter; nothing here rules it out.
- **targus runs `play` itself from the decorator.** It would not need Storybook's option, but
  would reimplement what Storybook does, including the error and the render signal.
- **A host view with a ref as the search root.** It needs `react-native` in a package that
  deliberately does not import it, and cannot be tested in Node.
- **State through args only.** Always available, and still the better choice when a story only
  needs to show a state; it does not exercise the handler.
