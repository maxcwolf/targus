# 0033. The CLI silences system notices before capture

## Status

accepted

## Date

2026-11-07

## Context

On 2026-11-07 the demo's main build reported 3 changed stories that had not changed. Each
screenshot showed a "Ready for Apple Intelligence" banner across the top of the simulator's
screen. The banner sat still long enough to pass the CLI's stability check, so nothing marked
the capture as suspect.

The demo's workflow, and the CI guides, wait after booting the simulator (45 seconds, or 150 on a
new simulator) so that first-run notices are gone before the capture starts. That wait is paid on
every pull request, and it did not work: the banner arrived during the capture anyway, on a
simulator reused from a run about 23 hours earlier.

Probing iOS 18.3 and 26.2 simulators on 2026-11-07, with the simulator's logs, showed how the
notice works:

- `com.apple.generativeexperiencesd` posts it as a follow-up item whenever Apple Intelligence
  availability changes in the simulator. Availability follows the host Mac and its downloaded
  models. A simulator's first boot always posts it, about 14 seconds after boot and before
  `simctl bootstatus` returns. Seeding the simulator's preferences before that boot does not stop
  it.
- `com.apple.followupd` turns the item into a notification under Settings, and schedules a
  reminder every 86400 seconds. That reminder fits the banner 23 hours after the last run.
- After a reboot, a notification that was already delivered is not shown as a banner again.
- `launchctl disable` inside the simulator keeps launchd from starting a service, and
  `launchctl bootout` stops the copy already running, with no reboot. The runtimes disagree on the
  domain: iOS 18.3 keeps a `system/` disable only until the next boot, and iOS 26.2 ignores a
  `user/foreground/` bootout. Sending both covers both. `disable` succeeds for a label the runtime
  does not have; `bootout` exits non-zero ("No such process") where a service is not loaded.
- launchd keeps the disable list in memory, not in a file in the simulator's data directory, so
  it cannot be written before the first boot.
- `simctl list devices --json` leaves out `lastBootedAt` for a simulator that has never booted.

A first attempt that disabled only `generativeexperiencesd` after boot still let the banner into
6 of 92 stories on a brand-new simulator: the item had been posted before the CLI acted, and
`followupd` showed it.

## Decision

We will add `silenceSystemNotices()` to the `DeviceDriver` port. `targus capture` (and so
`targus run`) calls it right after `boot`, before the status bar override, on every run.

`SimctlDriver` implements it with `xcrun simctl spawn <udid> launchctl`: it disables
`com.apple.generativeexperiencesd` and `com.apple.followupd` in `user/foreground` and `system`,
then boots both out of both domains. A bootout that exits 3 or 113 (nothing running, or no such
label) is expected; any other refusal is printed as a warning and the capture goes on. A failed
`disable` and a timeout fail the capture, like any other simctl call that goes wrong.

`SimctlDriver.boot()` first asks simctl whether the simulator has ever booted. On a first boot it
boots, silences the notices, shuts down and boots again, so the banner queued by the first boot
is dropped. A list that fails or does not name the simulator counts as "booted before". On a first
boot the silence step runs twice, before the reboot and after it, because iOS 18.3 forgets the
`system/` disable across the reboot.

Once the simulator has booted, simctl no longer reports it as new, so a first-boot sequence that
fails partway cannot be repeated by the next run. The driver then shuts the simulator down before
failing: the next run's boot is a reboot, which drops the banner already delivered, and the usual
silence step follows it.

CI should let targus boot the simulator and should not wait after boot.

## Consequences

### Positive

- The Apple Intelligence banner can no longer land in a capture, on any Mac, and CI needs no wait
  after boot. A reused simulator pays about one second for the `launchctl` calls.
- Running the step on every capture means it does not depend on the disable surviving a reboot,
  which iOS 18 does not guarantee.
- The port names the concern, so an Android driver has a place to silence its own notices.

### Negative

- A simulator's first boot costs one extra reboot, roughly 15 to 30 seconds. A CI runner that
  creates a new simulator for every job pays it every time.
- A simulator booted by something else before targus runs is not recognised as new, and its first
  banner can still reach the first stories. The guides tell users to let targus boot it.
- The CLI changes state inside the simulator it is given: Apple Intelligence onboarding and every
  other Settings follow-up stay off on that simulator until `launchctl enable` or an erase.
- The list covers the one notice seen so far. Another system banner needs its own entry, found
  the same way.
- It relies on undocumented simulator internals: service labels and launchd domains that a future
  runtime can rename.

## Alternatives considered

- **Wait after boot.** It costs every pull request, and the banner still arrived mid-run, because
  `followupd`'s reminder follows a daily timer, not the boot.
- **Disable only `generativeexperiencesd`.** Too late on a first boot, and it leaves an item
  already posted to `followupd`'s reminder.
- **Seed preferences before the first boot.** Tried; the first boot posts the notice anyway.
- **Turn Apple Intelligence off on the host Mac.** Probably works, but it is untested, changes the
  user's own machine, and is a setup step every user would have to know about.
- **Erase the simulator before each run.** An erased simulator boots as new, so it posts the
  notice again and pays the first-boot reboot every run, and it loses the installed app.
- **Mask a fixed region at the top of the screen.** The banner would no longer count as a change,
  and neither would a real change in that region, such as a header or navigation bar.
- **Detect a banner in the screenshot and retry.** The banner's position and look vary, and a
  heuristic for "system overlay" risks discarding real app content.
- **Do it in the demo's workflow.** It would fix the demo only.
