# 0021. Stop the capture as soon as the app dies

## Status

accepted

## Date

2026-11-06

## Context

`targus capture` and `targus run` launch the app on the simulator and then wait on the Storybook
channel (ADR 0008): up to `--connect-timeout` (120 s in CI) for the app to connect and send its
index, then up to `--render-timeout` for each story. Nothing checked that the app was still
alive. A consumer's CI had a crash report two seconds after launch and targus reported "the app
did not connect" two minutes later, which points at the wrong cause. An app that crashes mid-run
was worse: every remaining story waited out its own render timeout, one after another.

Two facts make a cheap liveness check possible:

- `xcrun simctl launch` prints `<bundle id>: <pid>`, and a simulator app is an ordinary macOS
  process with that pid on the host, so `kill(pid, 0)` tells whether it still exists without
  another simctl call. (Assumption: confirmed by how simctl and CoreSimulator work, not yet on
  a real simulator in this repo's tests.)
- When the app process dies its websocket closes, so the channel server sees the disconnect at
  once.

## Decision

We will add one method to each device-facing port in `packages/core/src/ports/`:

- `DeviceDriver.isAppRunning(bundleId): Promise<boolean>`: whether the process `launch` started
  is still alive; `true` when the driver cannot tell, so an unknown never fails a run.
  `SimctlDriver` keeps the pid `simctl launch` printed and sends it signal 0.
- `StorybookChannel.whenDisconnected(): Promise<void>`: resolves when the app, having connected,
  drops its last connection; never for the CLI's own `close()`.

The fakes gain `FakeDeviceDriver.exitApp()`, `FakeStorybookChannel.disconnect()` and a
`disconnect` story outcome.

The CLI wraps the whole capture, index wait included, in `whileAppRuns`
(`packages/cli/src/capture/app-watch.ts`). It polls `isAppRunning` every second, listens for
`whenDisconnected`, and races both against the capture. Whichever fires first rejects with an
`AppExitedError` (a `TargusError`, exit code 1) that names the bundle id, how many stories were
done out of how many, and, for an exit, `~/Library/Logs/DiagnosticReports` where the simulator
writes crash reports. A disconnect while the process still runs gets its own wording. The watch
then aborts an `AbortSignal` that `captureStories` checks after each story, so the loop stops
in the background without reporting the story in flight.

Stories captured before the crash are discarded, as with every other fatal capture error: no
`manifest.json` or PNGs are written, and `targus run` opens no build. A partial build would show
every story after the crash as removed.

## Consequences

### Positive

- A crash at launch fails the job within about a second with the real cause, not after the
  connect timeout with a misleading one.
- A crash mid-run fails at once instead of after one render timeout per remaining story.
- The per-story loop body is unchanged; the watch wraps the loop, so other changes to the loop
  do not have to know about it.

### Negative

- Any disconnect is fatal. An app that drops and re-opens its channel (a dev reload) now stops
  the run where before it might have recovered. Release bundles used in CI do not reload.
- Implementers of `DeviceDriver` and `StorybookChannel` outside this repo must add the two
  methods. Both packages are pre-1.0 and have no such implementers yet.
- The pid check relies on simulator apps being host processes; a future remote device driver
  needs its own check (an `AdbDriver` would ask `adb shell pidof`).

## Alternatives considered

- **Poll `simctl spawn <udid> launchctl list` for the app.** Goes through `exec` with a timeout
  and does not depend on the pid, but costs a subprocess per poll and parsing launchd output.
  Kept as the fallback if the pid check proves unreliable.
- **Watch for a new file in `~/Library/Logs/DiagnosticReports`.** Names the exact report, but
  reports are written seconds after the crash, the folder is shared with every other process
  on the host, and an app killed by the watchdog writes none.
- **Reject the in-flight story on disconnect and keep going.** Every later story would fail the
  same way and the run would end with a capture full of errors instead of one clear message.
- **Keep the stories captured before the crash and open a build.** The review would show the
  missing stories as removed and invite approving a broken run.
