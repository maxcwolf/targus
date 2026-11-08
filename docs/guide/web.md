# Capture a web Storybook

targus captures a built web Storybook as well as an on-device one. Each story opens alone in
headless Chromium, cropped to what it rendered. The capture is diffed against the web baselines
and published as a web build with its own `targus/web` check. A project can capture iOS, web or
both; see [Native, web or both](#native-web-or-both).

Stories written for Chromatic work as they are. Without `parameters.targus`, targus reads
`parameters.chromatic`: `disable`, `disableSnapshot`, `delay` and `modes`. See
[Story parameters](../reference/story-parameters.md#on-the-web).

## What you need

- A Storybook 7 or later that `storybook build` can build. An Expo app's stories rendered with
  `@storybook/react-native-web-vite` work, and so does any React web Storybook.
- `playwright-core` in the project that runs targus. It is an optional peer dependency of the
  CLI, loaded only for web captures:

  ```sh
  yarn add -D playwright-core
  ```

- Chromium for that `playwright-core` version. In CI, run in the
  `mcr.microsoft.com/playwright` image of the same version, which has it already. On your own
  machine:

  ```sh
  npx playwright-core install chromium
  ```

## Capture on your own machine

Build the Storybook, then capture it. `--storybook` takes the build directory, which targus
serves on a local port, or the URL of a Storybook that is already served:

```sh
yarn storybook build --output-dir storybook-static
npx targus capture --platform web --storybook storybook-static --out visual/web
```

The capture writes one PNG per story and a `manifest.json`, as a simulator capture does. Open a
few PNGs to check the crop. Compare two captures offline with
[`targus compare`](../reference/cli.md#targus-compare).

## What a capture is

- **One story per page.** Each story opens as `iframe.html?id=<story id>`, with nothing else on
  the page, and targus waits for Storybook's render event, web fonts, images and two animation
  frames.
- **Cropped to the story.** The screenshot is the bounding box of `#storybook-root`, however
  tall. A story that renders nothing is captured as the whole viewport.
- **A fixed browser.** The viewport is 1200x900 CSS pixels at pixel ratio 1 unless
  `--viewport` and `--pixel-ratio` say otherwise. The page prefers reduced motion and a light
  colour scheme, in `en-US` and UTC, so the same story renders the same pixels on every run.
- **The device name is the browser.** A web build records `chromium <version>` as its device,
  unless `--device-name` names it. Pin the `playwright-core` version, and the Playwright image in
  CI: another Chromium can move text by a pixel and show every story as changed.

A story that renders differently each time (a clock, a random id, an endless animation) is
`unstable`. Fix it as on a device; see
[Make stories deterministic](prepare-your-app.md#4-make-stories-deterministic), or skip it with
`parameters.targus.skip`.

## Modes

A story can be captured in several sets of globals, a dark theme or a narrow viewport for
instance, each as its own snapshot with its own baseline. See
[Modes](../reference/story-parameters.md#modes). Native captures ignore modes for now.

## Run it in GitHub Actions

A web job runs on Linux, in the Playwright image of the `playwright-core` version the project
pins. Add it next to the iOS job of [Run targus in GitHub Actions](ci-github-actions.md), or use
it alone:

```yaml
jobs:
  visual-web:
    runs-on: ubuntu-24.04
    # The same version as playwright-core in package.json.
    container: mcr.microsoft.com/playwright:v1.64.1-noble
    timeout-minutes: 20
    env:
      TARGUS_API_URL: https://<targus host>
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # targus run needs the history to find the merge base with main
      # The container runs as root on a checkout the runner owns.
      - run: git config --global --add safe.directory "$GITHUB_WORKSPACE"
      - run: corepack enable
      - run: yarn install --immutable
      - run: yarn storybook build --output-dir storybook-static

      - name: Capture and publish
        env:
          TARGUS_TOKEN: ${{ secrets.TARGUS_TOKEN }}
        run: |
          npx targus run \
            --platform web \
            --storybook storybook-static \
            --out visual/web \
            --sha "${{ github.event.pull_request.head.sha || github.sha }}"
```

`TARGUS_API_URL`, the secret, `fetch-depth: 0` and `--sha` are there for the same reasons as in
the iOS job. The web build reports the `targus/web` check; make it required like `targus/ios`.

## Native, web or both

A `targus.config.ts` (or `targus.config.json`) at the root of the project names the platforms it
captures and the settings of each, so `targus run` with no platform flags captures and publishes
every one of them, each as its own build:

```ts
import { defineConfig } from '@targus/cli';

export default defineConfig({
  platforms: {
    ios: { app: 'build/MyApp.app', deviceName: 'iPhone 16' },
    web: { storybook: 'storybook-static', viewport: '1200x900' },
  },
});
```

`--platform ios`, `--platform web` or `--platform ios,web` picks some of them for one run, which
is how a CI workflow runs each platform in its own job. Without a config file, `targus run`
captures iOS, as it always has. Every key is in the
[config file reference](../reference/config-file.md).
