---
'@targus/core': minor
'@targus/cli': minor
---

`targus capture` and `targus run` put the iOS simulator in light mode before the app launches, so
an app whose theme follows the system is captured the same way on every machine, whatever the
simulator was last set to. Pass `--appearance dark` to capture dark mode instead. The mode is
recorded in `manifest.json` (`summary.device.appearance`) and sent with the build, which shows it
next to the device; `--from-capture` sends the mode the capture was made in.

Core gains the `Appearance` contract (`light` or `dark`), an optional `appearance` on
`CreateBuildRequest` (`null` when absent) and a nullable `appearance` on `Build`.

Breaking for anyone with their own `DeviceDriver`: the port gains a required
`setAppearance(appearance): Promise<void>`, which `targus capture` calls after
`silenceSystemNotices` and before the app is installed and launched.
