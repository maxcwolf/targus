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

"The app folder" below is the React Native app's own folder: the one with its app.json (Expo) or
ios/ folder and its own package.json. In a single-app repository that is the repository root; in
a monorepo it is a package such as apps/mobile. Every path below (.rnstorybook/, scripts/,
build/, visual/) is relative to the app folder, the packages go into its package.json, and the
scripts cd to it.

Step 1, look before changing anything, and tell me what you find:
- The app folder; Expo or bare React Native; the package manager (yarn, npm, pnpm, bun); the
  app's entry file.
- The Storybook config folder (usually .rnstorybook/) and the @storybook/react-native version.
  targus needs 10 or later. If it is older or missing, stop and tell me.
- How Storybook is switched on (often process.env.EXPO_PUBLIC_STORYBOOK_ENABLED in App.tsx or
  the entry file), or that the app is only a Storybook and needs no switch.
- The iOS workspace and scheme name: the ios/*.xcworkspace file. Before the first expo prebuild
  there is no ios/ folder: Expo names it after expo.name in app.json with everything but letters
  and digits removed ("My App" becomes MyApp).
- Any part of targus that is already set up (an EXPO_PUBLIC_TARGUS switch, withTargus, the two
  scripts) and the repository's own rules for changes (AGENTS.md, CONTRIBUTING, its check
  command). Keep what is already there instead of adding a second copy.

Step 2, make these changes and nothing else:
1. Add @targus/cli and @targus/react-native as dev dependencies of the app folder's package.json
   with the repo's package manager. If they cannot be installed from the registry, they are not
   published yet: look for a targus checkout beside this repository (../targus from the
   repository root) and, if there is one, ask me before using it. If I agree:
   - add "@targus/react-native": "portal:<path>/packages/react-native" (Yarn; npm: "file:...")
     where <path> is the checkout relative to the app folder's package.json, and install from the
     repository root;
   - add a script "targus": "node <path>/packages/cli/dist/bin.js" instead of the @targus/cli
     dependency;
   - in the app's metro.config.js, after `config` is created and before it is exported or
     wrapped, add the targus package to config.watchFolders and a config.resolver.resolveRequest
     that resolves 'react' and 'react/*' imported from inside the package as if imported from the
     app folder (keep and call any existing resolveRequest). Find the package with
     path.resolve(fs.realpathSync(require.resolve('@targus/react-native')), '../..').
   If there is no checkout, stop and tell me; step 3 changes nothing, so do it anyway.
2. In .rnstorybook/preview.tsx: import { withTargus } from '@targus/react-native' and put it
   first in the `decorators` array, keeping the existing decorators after it.
3. In .rnstorybook/index.tsx: add
   const isTargus = process.env.EXPO_PUBLIC_TARGUS === 'true';
   and pass these to getStorybookUI, keeping every existing option:
   onDeviceUI: !isTargus, enableWebsockets: isTargus, shouldPersistSelection: !isTargus.
   If an equivalent switch already exists under another name, leave it. In a bare app without
   Expo, EXPO_PUBLIC_* is not inlined: use the build-time flag mechanism the app already has, and
   tell me which one you used.
4. Add scripts/build-ios-sim.sh: export EXPO_PUBLIC_STORYBOOK_ENABLED=true,
   EXPO_PUBLIC_TARGUS=true and LANG=en_US.UTF-8; run `npx expo prebuild --platform ios` only if
   ios/Pods is missing (bare apps: `pod install` in ios/ instead); then
   xcodebuild -workspace ios/<Name>.xcworkspace -scheme <Name> -configuration Release
     -sdk iphonesimulator -destination 'generic/platform=iOS Simulator'
     -derivedDataPath build/derived ONLY_ACTIVE_ARCH=YES ARCHS="$(uname -m)" build
   and copy build/derived/Build/Products/Release-iphonesimulator/<Name>.app to build/<Name>.app.
   Use `set -euo pipefail` and cd to the app folder first. If the repository root already has a
   scripts/ folder for other tooling and the app folder is not the root, put these in the app
   folder's scripts/.
5. Add scripts/bundle-js.sh: with the same two variables exported, run
   npx expo export:embed --platform ios --dev false --entry-file <entry file>
     --bundle-output build/bundle/main.jsbundle --assets-dest build/bundle/assets
   (bare apps: npx react-native bundle with the same flags), then copy main.jsbundle into
   build/<Name>.app/ and the assets folder's contents into build/<Name>.app/. Fail with a clear
   message if build/<Name>.app does not exist yet.
6. Ignore the app folder's visual/ and build/ in .gitignore if they are not ignored already.

Step 3, find stories that will not render the same twice. Do not change them; list each one with
the file, the reason and a proposed fix:
- the current date or time ("today", relative times): propose freezing the clock in
  preview.tsx when isTargus is true, for example with the mockdate package;
- random values, generated ids, faker data: propose fixed values;
- remote images or network data: propose local fixtures;
- a theme that follows the device's light or dark setting needs no fix, since targus captures
  in light mode; if the app has a dark theme, say that `targus run --appearance dark` to a
  second targus project reviews it;
- animations that loop forever (spinners, shimmers): propose
  parameters: { targus: { skip: true } } on the story; if the repository already marks such
  stories (for example a tag such as 'skip-visual'), say so and propose the same stories;
- animations that play once: propose parameters: { targus: { delay: <ms> } }, 0 to 10000.
Ask me before adding any dependency, mockdate included.

Rules:
- Never create, request, print or write a TARGUS_TOKEN or any other credential.
- Do not edit story files or components in this task.
- Do not run the Xcode build unless I ask: it takes several minutes.
- Run the repository's own check command if it has one, and tell me about any failure the
  changes caused.

Finish with: the check (or type check) result, every file you changed, the exact commands to
build and capture three stories, run from the app folder:
  bash scripts/build-ios-sim.sh
  xcrun simctl list devices available | grep "iPhone 16"
  npx targus capture --udid <udid> --app build/<Name>.app --out visual/current --limit 3
(`yarn targus` instead of `npx targus` if you added the script), and anything you could not
verify. If you stopped early, say at which step and why.
```

</details>

**What to expect:** a short report of what it found, a handful of changed files, and a list of
stories to make deterministic. Then build and capture with the commands it prints, or ask it to
run them. The [first capture prompt](first-capture.md) does that part.
