# 0006. iOS only, full-screen capture for v1

## Status

accepted

## Date

2026-11-04

## Context

the pilot app's CI already builds and boots iOS simulators on CircleCI macOS. Native rendering has more
noise than react-native-web, so v1 should capture in as few configurations as possible and make
each capture deterministic. Android, dark mode, font-scale modes and iPad are wanted later.

## Decision

We will support iOS only in v1, on one simulator, in light mode at the default font scale. The
CLI's `DeviceDriver` interface has one implementation, `SimctlDriver`. Each story is captured
as the full simulator screen with `simctl io screenshot`, after `simctl status_bar override`
fixes time, battery and signal. The simulator device type and iOS runtime are pinned in the
project config and stored on each build.

The data model carries a `variant` key on snapshots and approvals, reserved so Android, dark
mode and font scale slot in later without a schema rewrite.

Marked as assumptions in plan.md: the target is iPhone 16 on the iOS runtime shipped with the
Xcode on the pilot app's CircleCI image, and capture resolution is device pixels (3x), stored as-is
with the web app scaling for display.

## Consequences

### Positive

- One platform and one device keep the capture loop and CI job small.
- Full-screen capture needs no app-side view measurement and matches what a user sees.
- A status bar override removes the most obvious source of noise.
- An `AdbDriver` and new variants can be added behind existing interfaces.

### Negative

- Android regressions are not caught in v1.
- Full-screen captures include chrome outside the story, and 3x images are larger to store.
- Changing the device or runtime makes every story `new`, by design.

## Alternatives considered

- **iOS and Android together.** Deferred; Android lands with an `AdbDriver` in v1.1.
- **Multiple variants in v1 (dark mode, font scale, iPad).** Deferred; the `variant` key keeps
  the door open.
