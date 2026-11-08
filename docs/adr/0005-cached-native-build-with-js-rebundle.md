# 0005. Cached native build with a per-run JS rebundle

## Status

accepted, amended 2026-11-06

## Amended by

The decision still holds. On 2026-11-06 two statements in the text below were out of date:

- **"The Hermes bytecode question is unresolved until the spike reports."** The capture spike
  reported on 2026-11-04 (docs/capture-spike.md), and the Decision section records the answer: both
  a plain JS bundle and a `hermesc` bundle work.
- **The pilot app's `visual_ios` job** is not built yet (plan.md section 8). The steps in the Decision
  describe the planned job.

## Date

2026-11-04

## Context

Every PR and `main` build needs a simulator app running Storybook with that commit's JS. A
full native iOS build per run is slow, while most PRs change only JS. The pilot app already uses the
Expo fingerprint for OTA work, and builds and boots simulators on CircleCI macOS.

## Decision

We will cache the native simulator `.app` keyed by the Expo fingerprint and rebundle only the
JS per run. In the pilot app's `visual_ios` job:

1. `npx expo-updates fingerprint:generate --platform ios` gives the cache key
   `targus-ios-app-v1-{fingerprint}`.
2. On a cache miss, `eas build --local --platform ios --profile storybook:simulator` (a new
   profile cloned from an existing simulator profile) builds the app, which is then saved to the cache.
3. `expo export:embed --platform ios --dev false` runs with `EXPO_PUBLIC_STORYBOOK_ENABLED` and
   `EXPO_PUBLIC_TARGUS` set, and `main.jsbundle` and `assets/` are copied into the cached app.
4. `targus run --app <path>` captures; the CLI takes an explicit app path rather than guessing.

Confirmed by the capture spike (docs/capture-spike.md): Hermes accepts a plain JS bundle in a release
app, and a `hermesc`-compiled bundle works too. Both reproduced the Xcode-built baseline pixel
for pixel over a 15-story sample. The swap keeps the `hermesc` step (11 s) so CI loads the same
bytecode form production does; it is optional, not required. The bundling step must run with
exactly the env (`APP_VARIANT` and friends) the native build used.

## Consequences

### Positive

- Native rebuilds happen only when the fingerprint changes. Expected cost per PR after the
  first cached build is about 1 to 2 min for the JS bundle plus 3 to 5 min of capture.
- From docs/capture-spike.md: the pilot app's Xcode "Bundle React Native code and images" phase wraps
  bundling in a crash-reporting tool that fails without its API key. This path calls
  `expo export:embed` directly and never runs that phase for PR builds. Only the
  fingerprint-miss build touches it, through `eas build --local` with CI's secrets as today.

### Negative

- The bundle swap is a custom step that must track Expo's embed output layout.
- The Hermes bytecode question is unresolved until the spike reports.
- Per docs/capture-spike.md, bundling rewrites `.rnstorybook/storybook.requires.ts` unformatted, so
  the job must run `prettier --write` on it or ignore it to keep the tree clean.

## Alternatives considered

- **Full native build every run.** Simplest, but pays the native build cost on every PR.
- **Rely on the Xcode bundle phase.** Rejected for PR builds because of the crash-reporting tool's
  dependency described above.
