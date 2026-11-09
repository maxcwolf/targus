# 0042. A device captures a story at the content sizes it lists

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

We will capture a story on a device once per size in its `parameters.targus.contentSizes`,
beside its default capture.

- `contentSizes` is a list of short size names: `xs`, `s`, `m`, `l`, `xl`, `xxl`, `xxxl` for the
  seven standard categories, then `ax1` to `ax5` for the five accessibility ones. The names are
  targus's own; the simulator driver maps each to the category `simctl` takes, and an Android
  driver will map them to a font scale.
- The `DeviceDriver` port gains `setContentSize`. A run pins the default, `l`, after boot, as
  it pins light mode (ADR 0035).
- A story is always captured as `default` first. Then, for each size listed, the CLI sets the
  size, waits the settle time, and takes the two screenshots of the stability check. The story
  is not selected again. Afterwards the size goes back to the default and the app is given the
  settle time to follow.
- Each such capture is the variant named after its size, `<story id>@ax5`. The default size
  in the list adds nothing, and a size listed twice is captured once.
- A web capture ignores `contentSizes`. Modes stay what they were: globals and a viewport, on
  the web only.

## Consequences

### Positive

- The capture shows what a user with larger text sees, through the app's own scaling rules.
- Listing a size adds a snapshot and renames nothing: the `default` baseline of every existing
  story stays.
- No relaunch and no second pass: a sized capture cost about 1.6 s on the proof of concept.
- A story says what it wants in one short line, and the snapshot's name says what it is.

### Negative

- A project that checks a font scale on both platforms says so twice: a mode with its global
  for the web, `contentSizes` for the device.
- The size names are not Apple's, so the reference page carries the table.
- The size is changed while the app runs. A story after a failed reset would be captured at the
  wrong size, so a reset that fails ends the run.
- Dark mode per story and a second device size are not part of this.
- `parameters.chromatic.modes` is not read on a device, so a project's web font-scale modes do
  not become device captures by themselves.
- Proven on one simulator and one React Native version. An app that reads the font scale once
  at launch would not follow a live change.

## Alternatives considered

- **A `contentSize` key on a mode.** Built first: a named mode, as Chromatic writes them, with
  the category as its value. It made a story name a mode only to set one value, with a quoted
  key and a 37-character category, and it made the web and a device read the same modes
  differently. Dropped on review the same day.
- **Apple's category names as the values.** Exact, and too long to read in a list or in a
  snapshot's name.
- **A pass per content size, relaunching the app between passes.** Needed only if a running app
  did not follow the setting. The spike showed it does, and a pass would launch the app once
  per size and visit every story again.
- **A build-level flag, like `--appearance`.** Every story at one size, in a second build with
  its own baselines. Most stories do not need the second capture, and the review would be split
  across builds.
- **Setting a font scale inside the app through the decorator.** It is what the web does, and
  it skips the system's own path, which is the thing to test.
