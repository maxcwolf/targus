# M0 spike: capture the pilot app's native Storybook in an iOS simulator

Started 2026-11-04. Goal from [plan.md](plan.md#11-milestones): prove the capture loop locally
against `../the pilot app`, measure seconds per story, count unstable stories, and decide whether the
Storybook websocket channel is the right driving mechanism.

## Setup used

- Machine: macOS, Xcode 26.2, iPhone 16 simulator (the pilot app's CI pins Xcode 26.6).
- the pilot app at `<commit>` plus two local changes:
  - `.rnstorybook/index.tsx` passes `enableWebsockets`, `onDeviceUI: false`, and
    `shouldPersistSelection: false` when `EXPO_PUBLIC_TARGUS=true`.
  - `yarn.lock` bumps `expo-modules-jsi` 57.1.1 → 57.1.3 (see findings).
- Release simulator app built with
  `APP_VARIANT=staging EXPO_PUBLIC_STORYBOOK_ENABLED=true EXPO_PUBLIC_TARGUS=true npx expo run:ios --configuration Release --no-bundler`.
- Capture script: [spike/capture.mjs](../spike/capture.mjs). Bundle swap: [spike/rebundle.sh](../spike/rebundle.sh).

## Findings so far

### Storybook RN 10 ships the driving primitive

`@storybook/react-native/node` exports `createChannelServer`. The app connects to it as a
websocket client when `enableWebsockets` is on, and every message from one client is relayed to
the others as plain JSON `{ type, args }`. The capture script therefore holds its own socket,
sends `setCurrentStory`, and waits for `storyRendered` (or `storyUnchanged` when the story is
already on screen). `RN_GET_INDEX` returns the index the app actually loaded. The package's own
`POST /select-story-sync/:id` endpoint does the same thing but with a fixed 1 s render timeout,
so the CLI should drive the socket directly.

The CLI must resolve `@storybook/react-native` from the consumer project so the server and the
app bundle share a protocol version.

### expo-modules-jsi 57.1.1 does not compile with Xcode 26.2

The first build failed in `ExpoModulesJSI` on `SWIFT_RETURNS_RETAINED` constructor annotations.
expo-modules-jsi 57.1.2 fixes exactly this for Xcode 26 (changelog entry for
[expo/expo#51040](https://github.com/expo/expo/pull/51040)). the pilot app's lockfile pinned 57.1.1;
`yarn up -R expo-modules-jsi` moves it to 57.1.3 with no `package.json` change. This is a
the pilot app PR candidate independent of targus: anyone on Xcode 26.2 hits it on `yarn ios`.

### expo-observe does not compile in Swift 6 mode under Xcode 26.2

Second build failure: `expo-observe/ios/ObserveModule.swift` passes a payload derived from
`self` to `emit(event:payload: sending P)`, which Xcode 26.2's Swift rejects as a possible data
race. No published expo-observe or expo-modules-core version changes that line (checked
57.0.26 and 58.0.18), so this is a compiler-version difference against CI's Xcode 26.6. For
the spike the fix is a hand edit in `node_modules` (copy the integrations into a local and mark
the payload `nonisolated(unsafe)`). If the pilot app wants local builds on Xcode 26.2 it needs a
`patch-package` patch for expo-observe; otherwise developers must match CI's Xcode.

### the pilot app's Xcode bundle phase requires a Datadog API key

Even with `DISABLE_DATADOG_DSYM_UPLOAD=1`, the "Bundle React Native code and images" phase wraps
bundling in `datadog-ci react-native xcode`, which fails without `DATADOG_API_KEY` after the
bundle is built (`--dry-run` does not help; its metrics logger still needs the key). The spike
bypasses it with `ios/.xcode.env.local` pointing `DATADOG_CI_EXEC` at a shim that runs
`react-native-xcode.sh` directly.

Consequence for targus: the planned CI path never runs the Xcode bundle phase for PR builds. It
calls `expo export:embed` directly ([spike/rebundle.sh](../spike/rebundle.sh)), which does not
involve datadog-ci at all. Only the fingerprint-miss native build touches the phase, and that
runs through `eas build --local` with CI's secrets as today.

### Where the built app lands

`expo run:ios` leaves the `.app` in Xcode DerivedData, not `ios/build`. `eas build --local`
produces a tarball at `--output`. The CLI should take an explicit `--app` path rather than
guessing, and the CI job should normalise to a known location after whichever build ran.

### Metro regenerates `storybook.requires.ts` unformatted

Any bundle with Storybook enabled rewrites `.rnstorybook/storybook.requires.ts` with double
quotes; the committed file is Prettier-formatted. the pilot app's CI drift check presumably formats
before diffing. The targus CI job should run `prettier --write` on that file or ignore it in
`git status` checks so a capture run never leaves the tree dirty.

## Results

Full run manifest: `spike/out-full/manifest.json` (gitignored). Numbers from the run on
2026-11-04 against the pilot app `<commit>`, iPhone 16, iOS 18.3 runtime.

| Measure | Value |
| --- | --- |
| Stories in the on-device index | 354 (all type `story`; the file count of 120 undercounts because screens have many variants) |
| Captured / failed by the script | 354 / 0 |
| Capture loop wall time | 426 s (7 min 6 s); 7 min 9 s including boot, install and launch |
| Per story | mean 1205 ms, median 1021 ms, p90 1067 ms, max 4398 ms |
| `storyRendered` latency after `setCurrentStory` | 1 to 82 ms, median 2 ms |
| App connect after launch | about 1.5 s (bytecode), about 2.4 s (plain JS) |
| Unstable stories (two captures 150 ms apart still differ after 3 attempts) | 16, every one containing a spinning `ActivityIndicator` |
| Stories that settled on a second attempt | 10 (short entrance animations on success/confirmation alerts) |
| Rebundle (`expo export:embed` + `hermesc`) | 28.6 s; `hermesc` alone 11.3 s single-threaded |
| Bundle sizes | Xcode-built bytecode 11.8 MB; rebundled bytecode 14.5 MB; plain minified JS 9.9 MB |

### Bundle swap works in both modes

Swapping a freshly bundled `main.jsbundle` plus `assets/` into a copy of the Xcode-built app,
then ad-hoc re-signing, launched and connected in both modes. Over a 15-story sample each mode
produced 14 hashes identical to the baseline run; the one difference was a spinner story that
is unstable in every run. **Hermes accepts a plain JS bundle**, so `hermesc` is optional. It
costs 11 s and buys about 0.8 s of launch time per run, so the CI path can ship either way; the
plan keeps `hermesc` because it matches what production builds load and makes bytecode-only
bugs visible.

The rebundled bytecode is 2.7 MB larger than Xcode's, most likely because
[spike/rebundle.sh](../spike/rebundle.sh) did not set `APP_VARIANT=staging` so `app.config.ts`
resolved differently. The CI job must bundle with exactly the env the native build used, and
the CLI should record the bundling env in the build metadata.

### Decision: the websocket channel is the right driver

Selection is instant, the index comes from the app itself, and the server ships with
Storybook RN. Go.

### What the spike changed in the design

1. **Story errors are invisible on the channel.** Thirteen stories rendered Storybook's
   "Something went wrong rendering your story" box, yet the app emitted `storyRendered` and
   `storyFinished status=success`. Storybook RN's error boundary only `console.log`s. The device
   log showed the real cause (`No QueryClient set`, a missing provider in the pilot app's native
   `preview.tsx`). The `@targus/react-native` decorator will therefore wrap each story in its
   own error boundary and emit a `targus/storyError` channel event with the message and
   component stack. The CLI records it as an error, never as a snapshot. Reading device logs
   stays a fallback diagnostic, not the mechanism.
2. **`storyRendered` is a commit signal, not a paint signal.** It arrives within a few
   milliseconds, before layout and images. The settle delay plus the two-capture stability check
   is what makes captures correct; both stay, with `parameters.targus.delay` per story.
3. **Spinners are inherently unstable.** Native `ActivityIndicator` cannot be frozen from JS.
   v1 policy: an `unstable` snapshot is reported and shown in the UI but never blocks the check,
   and a story can opt out with `parameters.targus.skip`. Candidate for v1.1: auto-mask the
   union of regions that differ between the stability captures and diff the rest.
4. **No status bar.** With `onDeviceUI: false` Storybook RN renders `<StatusBar hidden />`, so
   the simctl status-bar override is moot. Keep it anyway (harmless, and protects a project
   that shows the bar), but do not rely on it.
5. **Blank and duplicate captures are a signal.** 83 of 354 captures share a hash with another
   story: 13 error boxes, 16 blank or "Web only." placeholders, and legitimately identical
   web-only hover/focus variants. The CLI will flag single-colour captures as `blank` and report
   duplicate-hash groups in the summary so projects can exclude web-only stories from the native
   index.
6. **Relative dates need a locked clock.** Several stories print dates relative to today.
   The targus decorator locks `Date` the way the pilot app's web preview already does with MockDate.
7. **Per-story cost is dominated by the two `simctl` screenshots plus settle**, not by
   rendering. Running two simulators in parallel on one macOS runner is the obvious v1.1 speedup.

### the pilot app follow-ups surfaced by the spike (not targus work)

- Native `.rnstorybook/preview.tsx` lacks `QueryClientProvider`, `SafeAreaProvider` and the
  MockDate decorator that the web preview has; 13 stories error on device as a result.
- Web-only stories (`webnavlayout`, breadcrumbs, web screen header) are in the native index and
  render "Web only." placeholders.
- `chatmessage--my-message` renders blank on device; cause not investigated.
- `weighthistory--with-data` renders its chart's filled area differently between app launches
  (2.2% of pixels; stable within a run). Found when the M1 CLI run was compared with the spike
  run. Needs a look before the check becomes required.
- `expo-modules-jsi` lockfile bump and an `expo-observe` patch are needed for local builds on
  Xcode 26.2 (see findings above).

## Spike state and cleanup

- the pilot app working tree: `.rnstorybook/index.tsx` (targus flags) and `yarn.lock`
  (expo-modules-jsi 57.1.3) are intentional uncommitted changes for you to keep or discard.
  `storybook.requires.ts` was restored. `node_modules/expo-observe` carries a hand edit and
  `ios/.xcode.env.local` points at a Datadog-skipping shim; both are local only and vanish on
  reinstall or prebuild.
- Captures and manifests live under `spike/out-*` (gitignored). App copies and logs are in the
  session scratchpad.
