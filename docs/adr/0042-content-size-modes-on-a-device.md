# 0042. A device captures a story's content size modes

## Status

accepted

## Date

2026-11-09

## Context

A team that checks its web Storybook at a large font scale has no way to do so on a device. On
the web that scale is a Storybook global the project's own decorator applies. On a phone the real
thing is a system setting: the preferred content size category, under Accessibility > Larger
Text. An app answers it with its own rules, such as a cap on how far a button's label grows, and
a mocked scale inside the app does not exercise them.

Modes exist for the web since web-plan.md step W5: `parameters.targus.modes` names sets of
globals and a viewport, each captured as its own variant with its own baseline. A device capture
ignored them.

`xcrun simctl ui <udid> content_size <category>` sets the category on a booted simulator. A
spike on 2026-11-09 (an Expo 57, React Native 0.86 app on an iPhone 16 simulator, iOS 18.3)
showed:

- A running app lays its text out again within 0.3 s of the call, with no relaunch.
- Setting the size back gives the same pixels as before, byte for byte.
- The setting persists across reboots, like the appearance.

## Decision

We will capture a story on a device once per mode that sets `contentSize`, beside its default
capture.

- A mode gains one reserved key, `contentSize`, whose value is one of the twelve categories
  `simctl` takes. It is not a global.
- The `DeviceDriver` port gains `setContentSize`. A run pins the default, `large`, after boot,
  as it pins light mode (ADR 0035).
- On a device a story is always captured as `default` first. Then, for each mode with a
  `contentSize`, the CLI sets the size, waits the settle time, and takes the two screenshots of
  the stability check. The story is not selected again. Afterwards the size goes back to the
  default and the app is given the settle time to follow.
- Each such capture is the variant named after the mode, `<story id>@<mode>`, as on the web.
- A device does not apply a mode's globals or viewport, so a mode without a `contentSize` adds
  no device capture. A mode named `default` is left out: that is the default capture's name.
- On the web a mode that sets only a `contentSize` has nothing to apply and is left out; a story
  with no other mode keeps its default capture. A mode with globals and a `contentSize` is
  captured on both.

## Consequences

### Positive

- The capture shows what a user with larger text sees, through the app's own scaling rules.
- Adding a mode adds a snapshot and renames nothing: the `default` baseline of every existing
  story stays.
- No relaunch and no second pass: a sized capture cost about 1.6 s on the proof of concept.
- One mode can serve both platforms: globals for the web, `contentSize` for the device.

### Negative

- Device and web read modes differently: the web replaces the default capture with the modes, a
  device adds to it. The reference page has to say so.
- The size is changed while the app runs. A story after a failed reset would be captured at the
  wrong size, so a reset that fails ends the run.
- Only the content size is a device mode. Dark mode per story and a second device size are not
  part of this.
- `parameters.chromatic.modes` is not read on a device, so a project's web font-scale modes do
  not become device modes by themselves; a story names the content size it wants.
- Proven on one simulator and one React Native version. An app that reads the font scale once
  at launch would not follow a live change.

## Alternatives considered

- **A pass per content size, relaunching the app between passes.** Needed only if a running app
  did not follow the setting. The spike showed it does, and a pass would launch the app once
  per size and visit every story again.
- **A build-level flag, like `--appearance`.** Every story at one size, in a second build with
  its own baselines. Most stories do not need the second capture, and the review would be split
  across builds.
- **Setting a font scale inside the app through the decorator.** It is what the web does, and
  it skips the system's own path, which is the thing to test.
