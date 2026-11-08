# Prompt: build the app and run my first capture

Run this after the [setup prompt](setup-app.md), in the same repository, on a Mac with Xcode. It
builds the simulator app, captures a few stories, looks at the screenshots and fixes what it
finds. Nothing is uploaded.

<details>
<summary><strong>Prompt: Build the app and run my first capture</strong> (click to open, then copy)</summary>

```text
Build this app for targus and run a first local capture. targus is set up already: there is a
withTargus decorator in .rnstorybook/preview.tsx, a capture-mode switch on
EXPO_PUBLIC_TARGUS in .rnstorybook/index.tsx, and scripts/build-ios-sim.sh and
scripts/bundle-js.sh. If any of those is missing, stop and tell me.

1. Check the machine: `xcodebuild -version`, Node 22 or later, and an "iPhone 16" simulator
   (`xcrun simctl list devices available`). If there is no iPhone 16, tell me which iPhones exist
   and use the newest one.
2. Run `bash scripts/build-ios-sim.sh`. It can take 5 to 15 minutes; run it in the background if
   you can and wait for it. If it fails, show me the first real error (not the last lines of the
   log) and fix it only if the cause is in the two scripts; otherwise stop and explain.
3. Take the simulator's UDID from `xcrun simctl list devices available` (do not boot it: targus
   capture boots it and silences system notices), and run:
     npx targus capture --udid <udid> --app build/<Name>.app --out visual/current --limit 5
   (use `yarn targus` instead of `npx targus` if package.json has a "targus" script).
4. Read the output. For each failure, use these meanings:
   - "the app did not connect within ...": the bundle was not built with EXPO_PUBLIC_TARGUS=true,
     or enableWebsockets is off, or the port differs from 7007. Check, fix, re-bundle with
     scripts/bundle-js.sh, retry once with --connect-timeout 120000.
   - "exited before any story was captured": a crash at launch. Find the newest crash report for
     the app in ~/Library/Logs/DiagnosticReports and summarise the crashing thread.
   - "ERROR <message>" on a story: the story threw while rendering; tell me which providers or
     props it is missing.
   - "UNSTABLE" or "blank": the story did not hold still or had not drawn yet.
5. Open the PNGs in visual/current and look at each one. Report anything that looks wrong: the
   Storybook sidebar or addons panel (capture mode is off), a system alert over the app, an empty
   or clipped story.
6. If the five look right, run the full capture without --limit and report the summary lines
   (captured, failed, unstable, blank, skipped) and the slowest stories.

Rules: do not publish anything (no `targus run`), never create or write a TARGUS_TOKEN, and ask me
before changing any story or component.

Finish with the summary, every file you changed, and what I should fix before turning on CI.
```

</details>
