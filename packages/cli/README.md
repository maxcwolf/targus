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
| `--api-url <url>`        | `TARGUS_API_URL`     | targus API base URL, see [Environment](#environment)    |
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

This needs the full git history. A shallow clone stops before the merge base, which git cannot
tell apart from unrelated histories, so every story would come out `new` with nothing compared;
`targus run` refuses one up front instead. On GitHub Actions set `fetch-depth: 0` on
`actions/checkout` (its default is `1`); elsewhere run `git fetch --unshallow` before
`targus run`. CircleCI's `checkout` step clones the full history already. If the fetch of the base
branch fails but `origin/<base-branch>` or a local `<base-branch>` exists (a laptop offline, or a
checkout without `origin`), `targus run` prints a warning and uses it; if neither exists it stops.
Any other git failure (not a repository, git missing, an unknown revision) stops the run with
git's message.

`--sha` replaces only the commit the build (and its check run) is for; the merge base is still
computed from `HEAD`. GitHub Actions `pull_request` workflows must pass it: there `actions/checkout`
checks out a synthetic merge commit, so `HEAD` is a sha that is not on the PR and the check run
would not show on it:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0 # full history: targus run refuses a shallow clone
- run: npx targus run --udid "$UDID" --app build/ExampleApp.app --sha ${{ github.event.pull_request.head.sha }}
  env:
    TARGUS_TOKEN: ${{ secrets.TARGUS_TOKEN }}
```

CircleCI checks out the PR head itself, so `HEAD` is already right there.

### Timeouts and retries

Nothing waits forever, so a hung simulator or a stalled network fails the job with a message
instead of running into the CI runner's own limit:

- Every `xcrun simctl`, `git` and `plutil` call has a timeout. `bootstatus` gets 5 minutes, an
  install 3 minutes, `git fetch` 5 minutes, and everything else between 30 seconds and a minute.
  A call that runs over is killed (SIGTERM, then SIGKILL 5 seconds later) and the run stops with
  `error: <command> did not finish within <time> and was stopped`.
- Every API request is aborted after 60 seconds, body included, as
  `error: <METHOD> <route>: no response from <api url> within 60s`.
- `--connect-timeout` bounds the wait for the app to connect to the channel.
- The app is watched for the whole capture: its process is checked every second and a dropped
  channel connection is noticed at once. A crash at launch stops the run within about a second
  with `error: the app <bundle id> exited before any story was captured, probably a crash at
launch: look for its crash report in ~/Library/Logs/DiagnosticReports`, rather than waiting out
  `--connect-timeout`. A crash mid-run stops it straight away with `exited after <n> of <total>
stories`, or `closed its Storybook channel connection after ...` when the process is still up.
  The stories captured before the crash are discarded: `targus capture` writes no output and
  `targus run` opens no build, since a partial build would show the rest as removed.
- Opening the build, image uploads, image downloads and the results submission are retried up
  to four times, 0.5s, 1s and 2s apart, on network errors, timeouts, 429 and 5xx; never on any
  other 4xx. Each retry prints a `warning:` line; when the last one fails the error ends with
  `(gave up after 4 attempts)`. Uploads are content-addressed, and the server stores a build's
  results only once, so a resend is safe: if the first submission landed but its response was
  lost, the retry gets a 409 and the error says so. Each run sends one idempotency key with every
  attempt to open its build, so a retry after a lost response gets the build the first attempt
  opened instead of opening another (ADR 0027).

## Environment

| Variable         | Used by       | Meaning                                       |
| ---------------- | ------------- | --------------------------------------------- |
| `TARGUS_TOKEN`   | `targus run`  | project token (required)                      |
| `TARGUS_API_URL` | `targus run`  | API base URL, default `http://localhost:8787` |
| CI variables     | `targus run`  | branch and PR detection, see above            |
| `TARGUS_DEBUG`   | every command | `1` or `true` adds stack traces to errors     |

The environment is read only when `targus run` starts, so `targus --help`, `targus --version` and
`targus <command> --help` work with nothing set; an invalid variable fails `run` with a message
naming it. The variables and `--api-url` are checked before git, the simulator or the API is touched, so a typo costs a
second, not a capture.

The API URL (`--api-url`, else `TARGUS_API_URL`, else `http://localhost:8787`) must be an
`http://` or `https://` URL with no user name or password (the token goes in `TARGUS_TOKEN`) and
no `?query` or `#fragment`. Trailing slashes are dropped, so `https://targus.example.com/` and
`https://targus.example.com` are the same. A path prefix is kept for an API behind a proxy:
`https://example.com/targus` sends `https://example.com/targus/api/builds`. A URL ending in `/api`
is rejected, since targus adds `/api` itself. A bad value fails at once, naming the flag or
variable and suggesting a fix, with any credentials in it masked:

```text
error: --api-url "targus.example.com" has no http:// or https:// scheme
  set --api-url or TARGUS_API_URL to the targus API's address, for example https://targus.example.com
```

`--api-url` wins over `TARGUS_API_URL`, which is then not checked. An empty `TARGUS_TOKEN` exits
`3` like a missing one.

## Errors

A failed command prints a few plain lines on stderr: what failed and, where the cause is known,
what to do about it. For example:

```text
error: POST /api/builds: cannot reach http://localhost:8787
  connection refused: 127.0.0.1:8787
  check the API URL (TARGUS_API_URL or --api-url) and that the targus API is reachable
```

Unreachable API, missing files, commands that are not installed (`xcrun`, `git`), a port already in
use and data that fails validation each get specific wording. When `targus run` looks up the
simulator's name and `xcrun simctl list devices --json` prints something it cannot read (nothing,
a warning instead of JSON, JSON of another shape), it says what was wrong and what to try:

```text
error: could not read the simulator list: its output is not JSON (it starts with "xcrun: warning: ...")
  run `xcrun simctl list devices --json` yourself to see what it prints, check that `xcode-select -p` points at the Xcode you expect, or pass --device-name to skip the lookup
```

`TARGUS_DEBUG=1` adds the parser's message and the start of the output. Anything else is reported as
`error: unexpected error: <message>`, which is probably a bug in targus. There is no stack trace by
default; set `TARGUS_DEBUG=1` to append the stack of the error and of every cause.

## Exit codes

| Code | Meaning                                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | the command completed. For `run` that includes builds with changes pending review: the `targus/ios` GitHub check is what gates the merge, not the CI step |
| `1`  | the command failed: invalid arguments or environment, capture failure, API or network error, bad response, missing file or command, unexpected error      |
| `2`  | the command is not implemented                                                                                                                            |
| `3`  | the API rejected the project token (`TARGUS_TOKEN` missing, wrong, or not allowed)                                                                        |

`--help` and `--version` exit `0`.

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
