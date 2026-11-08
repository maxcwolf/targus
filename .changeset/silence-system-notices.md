---
'@targus/core': minor
'@targus/cli': minor
---

`targus capture` and `targus run` keep the iOS simulator's "Ready for Apple Intelligence" banner
out of screenshots, so CI no longer needs to wait after booting the simulator. Right after boot
the CLI disables `com.apple.generativeexperiencesd` (which posts the notice whenever Apple
Intelligence availability changes) and `com.apple.followupd` (which shows it and reminds about it
daily) inside the simulator with `launchctl`. A simulator that has never booted is booted twice:
its first boot posts the notice before boot completes, and the reboot drops the queued banner.
Let targus boot the simulator rather than booting it yourself first, or it cannot tell a first
boot. The simulator keeps both services off afterwards; `xcrun simctl erase` restores them.

Breaking for anyone with their own `DeviceDriver`: the port gains a required
`silenceSystemNotices(): Promise<void>`, which `targus capture` calls after every `boot`. A driver
with nothing to silence can resolve at once.
