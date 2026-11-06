---
'@targus/core': minor
'@targus/cli': patch
---

`targus run` and `targus capture` now stop as soon as the app under test crashes. A crash at
launch fails within about a second with `the app <bundle id> exited before any story was
captured, probably a crash at launch` and points at `~/Library/Logs/DiagnosticReports`, instead
of waiting out `--connect-timeout` and reporting that the app never connected. A crash or a
dropped channel mid-run stops the capture at once and says how many stories were done; the
partial capture is discarded and no build is opened. The `DeviceDriver` port gains
`isAppRunning(bundleId)` and the `StorybookChannel` port gains `whenDisconnected()`, with
`exitApp()` and `disconnect()` on their fakes.
