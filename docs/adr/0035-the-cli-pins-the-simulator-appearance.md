# 0035. The CLI pins the simulator appearance

## Status

accepted

## Date

2026-11-07

## Context

A trial setup of a React Native app whose Storybook theme follows the device (its decorator falls
back to `system`) showed that nothing in targus fixed light or dark mode. The CLI boots the
simulator, silences system notices (ADR 0033) and overrides the status bar, but it never set the
appearance, so such an app was captured in whatever mode the simulator happened to be in. Two
Macs, or one simulator someone switched to dark mode in Xcode, would produce a build where every
themed story changed.

Probing an iOS 18.3 simulator with Xcode 26.2 on 2026-11-07 showed:

- `xcrun simctl ui <udid> appearance light|dark` sets the mode and exits 0; without an argument it
  prints the mode (`unknown` while the simulator is shut down).
- It needs a booted simulator: on a shut-down one it exits 149 ("Unable to lookup in current
  state: Shutdown").
- The setting persists across a shutdown and boot, so a simulator keeps whatever mode it was last
  given, by anyone.
- An app launched right after the call starts in the new mode. An app that is already running
  switches with a cross-fade: a screenshot taken at once was halfway between the two (mean
  brightness 154 between 237 and 26), one taken 300 ms later was fully switched.
- Setting the mode the simulator is already in is a no-op that exits 0.

## Decision

We will add `setAppearance(appearance)` to the `DeviceDriver` port, with `Appearance` (`light` or
`dark`) as a core contract. `targus capture` and `targus run` take `--appearance <light|dark>`,
default `light`, and call `setAppearance` on every run, after `silenceSystemNotices` and before
the status bar override, the install and the launch. `SimctlDriver` implements it with
`xcrun simctl ui <udid> appearance <mode>`. Because the app is launched afterwards, no relaunch
and no settle are needed.

The capture records the mode in `manifest.json` as `summary.device.appearance`. `targus run`
sends it as `appearance` when it opens the build, taking it from the manifest, so a
`--from-capture` build reports the mode the capture was made in rather than a flag. The API stores
it in a nullable `builds.appearance` column (migration 0010), returns it on `Build`, and counts it
among the fields an idempotent replay must repeat (ADR 0027). The review UI shows it after the
device name.

Compatibility: `CreateBuildRequest.appearance` defaults to `null`, so a CLI that predates this
still opens builds, which read back with no appearance. A manifest without the field reads as
`null` too. An older API strips the unknown field, so a newer CLI still works against it.

## Consequences

### Positive

- An app whose theme follows the system is captured in the same mode on every machine and every
  run, whatever the simulator was last set to.
- Light is the default, which matches a fresh simulator and the mode most baselines were already
  captured in.
- Every build says which mode it was captured in, so a build where everything changed can be
  traced to a mode change, and a later rule can use it.

### Negative

- Breaking for anyone with their own `DeviceDriver`: the port gains a required method.
- A team that captured its baselines in dark mode without knowing it gets one build of changes
  the first time, until it accepts them or passes `--appearance dark`.
- Baselines are still picked per project and commit, not per appearance (or device). Reviewing
  both modes needs a second targus project for now.
- The migration has to be applied to D1 before the Worker that writes the column is deployed.

## Alternatives considered

- **Leave the simulator as it is and document setting it in CI.** Every team would have to know
  about it, and a simulator toggled by hand would still break builds silently.
- **Fold the mode into the device name (`iPhone 16 · dark`).** No migration, but it mixes two
  facts in one free-text field that nothing can query or check.
- **Set it after launch and wait for the cross-fade.** Slower and racier than setting it before
  the app starts, for no gain.
- **Capture both modes in one build as two variants of each story.** Doubles every capture for
  apps that do not theme, and needs the story index to carry the variant; a possible later step.
