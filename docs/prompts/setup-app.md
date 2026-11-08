# Prompt: prepare my app for targus

Paste this into Claude Code or Codex, started in your app's repository. It makes the changes from
[Prepare your app](../guide/prepare-your-app.md): it installs the packages, adds the decorator,
adds the capture-mode switch and the build scripts, and lists the stories that will not hold
still. It asks before adding anything beyond those, and never touches a token.

<details>
<summary><strong>Prompt: Prepare my app for targus</strong> (click to open, then copy)</summary>

```text
Set up targus visual testing in this React Native app. targus captures every on-device Storybook
story in an iOS simulator: the CLI hosts Storybook's websocket channel on localhost:7007 (the
simulator shares the Mac's localhost), the app connects to it, and the CLI selects each story and
screenshots it. The app is installed as a Release simulator build with the JavaScript bundled in,
with EXPO_PUBLIC_STORYBOOK_ENABLED=true and EXPO_PUBLIC_TARGUS=true set at bundle time.

Step 1, look before changing anything, and tell me what you find:
- Expo or bare React Native; the package manager (yarn, npm, pnpm, bun); the app's entry file.
- The Storybook config folder (usually .rnstorybook/) and the @storybook/react-native version.
  targus needs 10 or later. If it is older or missing, stop and tell me.
- How Storybook is switched on (often process.env.EXPO_PUBLIC_STORYBOOK_ENABLED in App.tsx or
  the entry file) and the iOS workspace and scheme name under ios/ (after prebuild, for Expo).

Step 2, make these changes and nothing else:
1. Add @targus/cli and @targus/react-native as dev dependencies with the repo's package manager.
   If they cannot be installed from the registry, stop and tell me: they may not be published
   yet, and I will set up a local checkout instead.
2. In .rnstorybook/preview.tsx: import { withTargus } from '@targus/react-native' and put it
   first in the `decorators` array, keeping the existing decorators after it.
3. In .rnstorybook/index.tsx: add
   const isTargus = process.env.EXPO_PUBLIC_TARGUS === 'true';
   and pass these to getStorybookUI, keeping every existing option:
   onDeviceUI: !isTargus, enableWebsockets: isTargus, shouldPersistSelection: !isTargus.
   In a bare app without Expo, EXPO_PUBLIC_* is not inlined: use the build-time flag mechanism
   the app already has, and tell me which one you used.
4. Add scripts/build-ios-sim.sh: export EXPO_PUBLIC_STORYBOOK_ENABLED=true,
   EXPO_PUBLIC_TARGUS=true and LANG=en_US.UTF-8; run `npx expo prebuild --platform ios` only if
   ios/Pods is missing (bare apps: `pod install` in ios/ instead); then
   xcodebuild -workspace ios/<Name>.xcworkspace -scheme <Name> -configuration Release
     -sdk iphonesimulator -destination 'generic/platform=iOS Simulator'
     -derivedDataPath build/derived ONLY_ACTIVE_ARCH=YES ARCHS="$(uname -m)" build
   and copy build/derived/Build/Products/Release-iphonesimulator/<Name>.app to build/<Name>.app.
   Use `set -euo pipefail` and cd to the repo root first.
5. Add scripts/bundle-js.sh: with the same two variables exported, run
   npx expo export:embed --platform ios --dev false --entry-file <entry file>
     --bundle-output build/bundle/main.jsbundle --assets-dest build/bundle/assets
   (bare apps: npx react-native bundle with the same flags), then copy main.jsbundle into
   build/<Name>.app/ and the assets folder's contents into build/<Name>.app/. Fail with a clear
   message if build/<Name>.app does not exist yet.
6. Add visual/ and build/ to .gitignore if they are not ignored already.

Step 3, find stories that will not render the same twice. Do not change them; list each one with
the file, the reason and a proposed fix:
- the current date or time ("today", relative times): propose freezing the clock in
  preview.tsx when isTargus is true, for example with the mockdate package;
- random values, generated ids, faker data: propose fixed values;
- remote images or network data: propose local fixtures;
- animations that loop forever (spinners, shimmers): propose
  parameters: { targus: { skip: true } } on the story;
- animations that play once: propose parameters: { targus: { delay: <ms> } }, 0 to 10000.
Ask me before adding any dependency, mockdate included.

Rules:
- Never create, request, print or write a TARGUS_TOKEN or any other credential.
- Do not edit story files or components in this task.
- Do not run the Xcode build unless I ask: it takes several minutes.

Finish with: the type check (or lint) result, every file you changed, the exact commands to build
and capture three stories:
  bash scripts/build-ios-sim.sh
  xcrun simctl list devices available | grep "iPhone 16"
  npx targus capture --udid <udid> --app build/<Name>.app --out visual/current --limit 3
and anything you could not verify.
```

</details>

**What to expect:** a short report of what it found, a handful of changed files, and a list of
stories to make deterministic. Then build and capture with the commands it prints, or ask it to
run them. The [first capture prompt](first-capture.md) does that part.
