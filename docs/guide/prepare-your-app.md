# Prepare your app

targus captures the app you already have, booted into its on-device Storybook. Four changes make
it capturable, and one build script turns it into a simulator app the CLI can install. This page
explains each one; the [Quickstart](quickstart.md) is the same steps without the explanations,
and the [setup prompt](../prompts/setup-app.md) has an AI agent make them for you.

You need an app where on-device Storybook already works in the iOS simulator
(`@storybook/react-native` 10 or later), usually switched on with an environment variable such
as `EXPO_PUBLIC_STORYBOOK_ENABLED=true`.

## 1. Install the packages

```sh
yarn add -D @targus/cli @targus/react-native   # or: npm install -D / pnpm add -D
```

- `@targus/cli` is the `targus` command. It runs on your Mac and in CI, never in the app.
- `@targus/react-native` is the decorator that runs inside Storybook. Its peer dependencies are
  `@storybook/react-native` 10+, `react` 19+ and `react-native` 0.79+.

<details>
<summary><strong>Until the packages are on npm</strong>: install them from a checkout of the targus repo</summary>

The `@targus/*` packages are not published yet. Until they are, check out the targus repo
**next to** your app and build the two packages:

```sh
git clone git@github.com:maxcwolf/targus.git ../targus
(cd ../targus && yarn install && yarn workspace @targus/cli build && yarn workspace @targus/react-native build)
```

Then, in your app:

- Add `"@targus/react-native": "portal:../targus/packages/react-native"` to `devDependencies`
  (Yarn; with npm use `"file:../targus/packages/react-native"`) and install.
- Add a script `"targus": "node ../targus/packages/cli/dist/bin.js"` and run the CLI as
  `yarn targus ...` wherever these docs say `npx targus ...`.
- Tell Metro to watch the package and to resolve `react` from your app, or the bundle gets two
  Reacts:

  ```js
  // metro.config.js, before the config is exported
  const path = require('node:path');
  const targusPackage = path.resolve(__dirname, '../targus/packages/react-native');
  config.watchFolders = [...(config.watchFolders ?? []), targusPackage];
  const upstreamResolveRequest = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const resolve = upstreamResolveRequest ?? context.resolveRequest;
    const fromTargus = context.originModulePath.startsWith(targusPackage + path.sep);
    if (fromTargus && (moduleName === 'react' || moduleName.startsWith('react/'))) {
      return resolve({ ...context, originModulePath: path.join(__dirname, 'index.ts') }, moduleName, platform);
    }
    return resolve(context, moduleName, platform);
  };
  ```

In CI, check out the targus repo beside yours with a read-only deploy key; the
[GitHub Actions guide](ci-github-actions.md#until-the-packages-are-on-npm) shows the steps.

</details>

## 2. Add the `withTargus` decorator

In `.rnstorybook/preview.tsx`, put `withTargus` first in `decorators`:

```tsx
import type { Preview } from '@storybook/react-native';
import { withTargus } from '@targus/react-native';

const preview: Preview = {
  decorators: [withTargus /* , your other decorators */],
};

export default preview;
```

The decorator does two things:

- It catches a story that throws while rendering, renders nothing in its place and reports the
  error, so the story is recorded as `error` with its message instead of a screenshot of an
  error screen.
- It reports the story's [`parameters.targus`](../reference/story-parameters.md) (`skip`,
  `delay`) to the CLI.

It reports through Storybook's own channel, which only targus listens to, so it is safe to leave
on in the Storybook your team uses every day.

## 3. Switch Storybook into capture mode

The CLI drives the app over Storybook's websocket channel: it hosts the channel on port 7007 of
the Mac, and the app connects to it (the simulator shares the Mac's `localhost`). Turn the
channel on, and the on-device UI off, only when the app is built for targus. A second variable,
`EXPO_PUBLIC_TARGUS`, keeps that separate from the Storybook builds your team uses by hand.

In `.rnstorybook/index.tsx`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { view } from './storybook.requires';

const isTargus = process.env.EXPO_PUBLIC_TARGUS === 'true';

const StorybookUI = view.getStorybookUI({
  storage: { getItem: AsyncStorage.getItem, setItem: AsyncStorage.setItem },
  // Under targus: no sidebar or addons panel, so the story fills the screen...
  onDeviceUI: !isTargus,
  // ...the CLI selects stories over the channel (localhost:7007 by default)...
  enableWebsockets: isTargus,
  // ...and the app never reopens the story it showed last time.
  shouldPersistSelection: !isTargus,
});

export default StorybookUI;
```

Keep whatever other options you already pass. If you change the port (`port` here), pass the same
number to the CLI with `--port`.

`EXPO_PUBLIC_*` variables are inlined into the bundle by Expo's Babel preset. In a bare React
Native app without Expo, use whatever build-time flag you already have (for example
`babel-plugin-transform-inline-environment-variables` or `react-native-config`); the variable's
name does not matter to targus.

## 4. Make stories deterministic

targus compares pixels, so a story that renders differently from one run to the next shows up as
a change nobody made. The usual causes, and their fixes:

| Cause                                         | Fix                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| "Today", "3 days ago", the current time       | Freeze the clock under targus, for example with [`mockdate`](https://www.npmjs.com/package/mockdate) (below)             |
| Random data (`Math.random`, faker, UUIDs)     | Seed it, or pass fixed props in the story                                                                               |
| Remote images or data                         | Use local fixtures; a network request may not finish before the screenshot                                               |
| An animation that runs forever (spinners)     | `parameters: { targus: { skip: true } }`, or render a still frame under targus                                         |
| An animation that runs in, then stops         | `parameters: { targus: { delay: <ms> } }` a little longer than the animation                                             |
| A blinking text cursor in a focused input     | Do not autofocus inputs in stories, or hide the caret (`caretHidden`) under targus                                       |

Freezing the clock, in `.rnstorybook/preview.tsx`:

```tsx
import MockDate from 'mockdate';

if (process.env.EXPO_PUBLIC_TARGUS === 'true') {
  // Every story sees this instant as "now" during a capture.
  MockDate.set('2026-01-15T17:00:00.000Z');
}
```

Format dates in a fixed time zone (or UTC) in those components, so the result does not depend on
the time zone of the Mac running the capture.

targus already takes care of the rest: it overrides the simulator's status bar, puts the simulator
in light mode before the app launches, and screenshots each story twice to make sure it holds
still, retrying with a longer wait before it calls a story `unstable`.

A theme that follows the system (`useColorScheme()`, or a Storybook decorator that falls back to
`system`) therefore renders light under targus on every machine, whatever the simulator was last
set to. To review dark mode too, run a second `targus run --appearance dark` that publishes to a
targus project of its own, so its baselines are dark ones; see
[`targus capture`](../reference/cli.md#targus-capture). A story that pins its own theme is not
affected by either setting.

## 5. Build the simulator app

targus installs a **Release** build for the iOS simulator with the JavaScript bundled in, so no
Metro server is involved. Build it with both variables set, so the bundle contains Storybook in
capture mode. For an Expo app, save this as `scripts/build-ios-sim.sh` and replace `MyApp` with
your workspace and scheme name (the `ios/*.xcworkspace` file):

```sh
#!/usr/bin/env bash
# Builds build/MyApp.app: a Release simulator app with Storybook in capture mode bundled in.
set -euo pipefail
cd "$(dirname "$0")/.."

export EXPO_PUBLIC_STORYBOOK_ENABLED=true
export EXPO_PUBLIC_TARGUS=true
export LANG=en_US.UTF-8

[ -d ios/Pods ] || npx expo prebuild --platform ios

xcodebuild \
  -workspace ios/MyApp.xcworkspace \
  -scheme MyApp \
  -configuration Release \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build/derived \
  ONLY_ACTIVE_ARCH=YES ARCHS="$(uname -m)" COMPILER_INDEX_STORE_ENABLE=NO \
  build

rm -rf build/MyApp.app
cp -R build/derived/Build/Products/Release-iphonesimulator/MyApp.app build/MyApp.app
echo "built build/MyApp.app"
```

In a bare React Native app, drop the `expo prebuild` line and run `pod install` in `ios/` instead.

The native build takes minutes. When only JavaScript changed, re-bundle it and swap it into the
existing app instead, which takes seconds. Save this as `scripts/bundle-js.sh`:

```sh
#!/usr/bin/env bash
# Re-bundles the JavaScript in capture mode and swaps it into build/MyApp.app.
set -euo pipefail
cd "$(dirname "$0")/.."

APP=build/MyApp.app
[ -d "$APP" ] || { echo "missing $APP: run scripts/build-ios-sim.sh first" >&2; exit 1; }

export EXPO_PUBLIC_STORYBOOK_ENABLED=true
export EXPO_PUBLIC_TARGUS=true

rm -rf build/bundle && mkdir -p build/bundle/assets
npx expo export:embed --platform ios --dev false --entry-file index.ts \
  --bundle-output build/bundle/main.jsbundle --assets-dest build/bundle/assets

cp build/bundle/main.jsbundle "$APP/main.jsbundle"
cp -R build/bundle/assets/. "$APP/"
echo "swapped the bundle into $APP"
```

Use your app's entry file for `--entry-file` (`index.ts`, `index.js`, or Expo Router's
`expo-router/entry`). In a bare app, use `npx react-native bundle` with the same flags. The
bundling step must see the same environment as the native build, or the app's config resolves
differently and the bundle drifts from the binary.

CI caches the native app and runs only the bundling step on most builds; the
[GitHub Actions guide](ci-github-actions.md) shows how.

## 6. Check it

Capture a few stories; `targus capture` boots the simulator itself. Nothing is uploaded, and no
token is needed:

```sh
xcrun simctl list devices available | grep "iPhone 16"   # copy a UDID in parentheses
npx targus capture --udid <udid> --app build/MyApp.app --out visual/current --limit 3
open visual/current
```

Each story is a `<storyId>.png` in `visual/current`, next to a `manifest.json`. If a screenshot
shows the Storybook sidebar, the app was built without `EXPO_PUBLIC_TARGUS=true`. If the command
waits and then times out on the connection, see
[Troubleshooting](troubleshooting.md#the-app-never-connects).

Add `visual/` to `.gitignore`.

## Next

[Run it in CI](ci-github-actions.md), so every pull request gets a `targus/ios` check.
