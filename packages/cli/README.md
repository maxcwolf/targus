# @targus/cli

The `targus` binary: captures on-device Storybook stories in an iOS simulator, diffs them against
the accepted baselines on the CI runner, and publishes the build to the targus service for review.
Background: [docs/plan.md](../../docs/plan.md) sections 4, 5.1 and 8, ADRs 0003 and 0004.

## Commands

### `targus capture`

Captures every story to a directory: one `<storyId>.png` per story plus `manifest.json`. Works
offline.

```sh
targus capture --udid <simulator-udid> --app build/ExampleApp.app --out visual/current
```

| Flag                     | Default           | Meaning                                       |
| ------------------------ | ----------------- | --------------------------------------------- |
| `--udid <id>`            | required          | simulator UDID (`xcrun simctl list devices`)  |
| `--app <path>`           | required          | built simulator `.app`                        |
| `--out <dir>`            | required          | output directory                              |
| `--bundle-id <id>`       | from `Info.plist` | app bundle id                                 |
| `--port <n>`             | `7007`            | Storybook channel port the app connects to    |
| `--settle <ms>`          | `300`             | wait after `storyRendered` before screenshots |
| `--stability-gap <ms>`   | `150`             | gap between the two stability screenshots     |
| `--render-timeout <ms>`  | `10000`           | how long to wait for `storyRendered`          |
| `--connect-timeout <ms>` | `60000`           | how long to wait for the app to connect       |
| `--attempts <n>`         | `3`               | stability attempts, settle doubling each time |
| `--filter <text>`        | all stories       | only stories whose id or title contains it    |
| `--limit <n>`            | all stories       | capture at most this many stories             |

### `targus compare`

Diffs a capture against a baseline capture and writes `report.json`, `report.html` and
`<storyId>.diff.png` files. Informational: it never fails on changes.

```sh
targus compare --current visual/current --baseline visual/baseline --out visual/report
```

`--threshold <ratio>` (default `0.001`, i.e. 0.1% of pixels) is the changed-pixel ratio above
which a story counts as changed.

### `targus run`

What CI calls. Captures (or loads a previous capture), opens a build on the targus API, downloads
only the baselines whose hash differs, diffs them locally, uploads the images the server is
missing plus diff images, and submits every story's result. Prints the build id on its own
`build: <id>` line (for scripts), a count per state, the review URL and the GitHub check run id.

```sh
# Capture and publish
TARGUS_TOKEN=... targus run --udid <simulator-udid> --app build/ExampleApp.app

# Publish a capture made earlier with `targus capture`
TARGUS_TOKEN=... targus run --from-capture visual/current --device-name "iPhone 16"
```

It accepts every `capture` flag above (with `--udid`, `--app` and `--out` optional) plus:

| Flag                     | Default              | Meaning                                                 |
| ------------------------ | -------------------- | ------------------------------------------------------- |
| `--from-capture <dir>`   | capture now          | skip the simulator, use a `targus capture` dir          |
| `--out <dir>`            | a temp directory     | where the capture is written                            |
| `--api-url <url>`        | `TARGUS_API_URL`     | targus API                                              |
| `--device-name <name>`   | the simulator's name | device the build is for; required with `--from-capture` |
| `--base-branch <branch>` | `main`               | default branch: merge base and `main` trigger           |
| `--branch <name>`        | CI env, then `git`   | branch of the build                                     |
| `--pr <n>`               | CI env               | pull request number                                     |
| `--sha <sha>`            | `git rev-parse HEAD` | commit of the build: a full 40-character lowercase sha  |
| `--threshold <ratio>`    | `0.001`              | changed-pixel ratio above which a story changed         |

The project token is read only from `TARGUS_TOKEN`; there is deliberately no flag, so it never
lands in shell history or CI logs.

Branch and PR number come from CircleCI (`CIRCLE_BRANCH`, `CIRCLE_PULL_REQUEST`,
`CIRCLE_PR_NUMBER`) or GitHub Actions (`GITHUB_HEAD_REF`, `GITHUB_REF_NAME`, `GITHUB_REF`);
`--branch` and `--pr` override them. A build on `--base-branch` without a PR is a `main` build;
everything else is a `pr` build. `targus run` fetches `origin/<base-branch>`, sends the merge base
with it and its first 100 first-parent ancestors so the server can pick the baseline (ADR 0004).

`--sha` replaces only the commit the build (and its check run) is for; the merge base is still
computed from `HEAD`. GitHub Actions `pull_request` workflows must pass it: there `actions/checkout`
checks out a synthetic merge commit, so `HEAD` is a sha that is not on the PR and the check run
would not show on it:

```yaml
- run: npx targus run --udid "$UDID" --app build/ExampleApp.app --sha ${{ github.event.pull_request.head.sha }}
  env:
    TARGUS_TOKEN: ${{ secrets.TARGUS_TOKEN }}
```

CircleCI checks out the PR head itself, so `HEAD` is already right there.

## Environment

| Variable         | Used by      | Meaning                                       |
| ---------------- | ------------ | --------------------------------------------- |
| `TARGUS_TOKEN`   | `targus run` | project token (required)                      |
| `TARGUS_API_URL` | `targus run` | API base URL, default `http://localhost:8787` |
| CI variables     | `targus run` | branch and PR detection, see above            |

## Exit codes

| Code | Meaning                                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | the command completed. For `run` that includes builds with changes pending review: the `targus/ios` GitHub check is what gates the merge, not the CI step |
| `1`  | the run itself failed: capture failure, invalid arguments, API or network error, bad response                                                             |
| `2`  | the command is not implemented                                                                                                                            |
| `3`  | the API rejected the project token (`TARGUS_TOKEN` missing, wrong, or not allowed)                                                                        |

## CI recipe (CircleCI)

A `visual_ios` job for PRs and `main` (plan.md section 8). The native app is rebuilt only when the
Expo fingerprint changes; every run re-bundles the JavaScript with Storybook on and swaps it into
the cached `.app`.

```yaml
jobs:
  visual_ios:
    macos:
      xcode: 16.2.0
    resource_class: m4pro.medium
    steps:
      - checkout
      - js-dependencies
      - setup-env
      - run:
          name: Fingerprint the native app
          command: npx expo-updates fingerprint:generate --platform ios | jq -r .hash > .ios-fingerprint
      - restore_cache:
          keys:
            - targus-ios-app-v1-{{ checksum ".ios-fingerprint" }}
      - run:
          name: Build the simulator app on a fingerprint miss
          command: |
            if [ ! -d build/ExampleApp.app ]; then
              eas build --local --platform ios --profile storybook:simulator --output build/app.tar.gz
              mkdir -p build && tar -xzf build/app.tar.gz -C build
            fi
      - save_cache:
          key: targus-ios-app-v1-{{ checksum ".ios-fingerprint" }}
          paths:
            - build/ExampleApp.app
      - run:
          name: Re-bundle JS with Storybook and swap it into the app
          command: |
            EXPO_PUBLIC_STORYBOOK_ENABLED=true EXPO_PUBLIC_TARGUS=true npx expo export:embed \
              --platform ios --dev false \
              --bundle-output build/main.jsbundle --assets-dest build/assets
            cp build/main.jsbundle build/ExampleApp.app/main.jsbundle
            cp -R build/assets/. build/ExampleApp.app/
      - run:
          name: Capture and publish
          command: |
            UDID=$(xcrun simctl list devices available --json \
              | jq -r '[.devices[][] | select(.name == "iPhone 16")][0].udid')
            npx targus run --udid "$UDID" --app build/ExampleApp.app --out visual/current
      - store_artifacts:
          path: visual/current

workflows:
  build:
    jobs:
      - visual_ios:
          context: targus # provides TARGUS_TOKEN and TARGUS_API_URL
```

The bundling step must use the same env as the native build, or `app.config.ts` resolves
differently and the bundle drifts.

## Fixtures

`yarn workspace @targus/cli fixture:capture <absolute-dir>` builds the package and writes a
three-story capture (two solid colours and a gradient, 24x48 px) with a valid `manifest.json`, for
end-to-end tests of `targus run --from-capture`. The same data is available programmatically as
`fixtureCaptureReport()` and `writeFixtureCapture(dir)`. The path is resolved against
`packages/cli`, so pass an absolute one. `e2e/run.spec.ts` imports `writeFixtureCapture` and runs
the built `dist/bin.js` against a local Worker (`yarn e2e` builds the package first).
