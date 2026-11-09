# CLI reference

The `targus` binary (`@targus/cli`) captures Storybook stories, on-device in an iOS simulator or
from a built web Storybook in headless Chromium ([web guide](../guide/web.md)), diffs them
against the accepted baselines on the machine it runs on, and publishes the build to the targus
service for review. A [`targus.config.json`](config-file.md) can name the platforms a project
captures.

> [!NOTE]
> The `--help` blocks on this page are generated from the CLI itself (`yarn docs:cli`), and
> `yarn check` fails when they are out of date. The text around them is written by hand.

<!-- cli-help: -->
```text
Usage: targus [options] [command]

Visual review for React Native on-device Storybook.

Options:
  -v, --version      output the version number
  -h, --help         display help for command

Commands:
  capture [options]  Capture every story to a directory with a manifest.json
                     (works offline).
  compare [options]  Diff a capture against a baseline capture and write an HTML
                     report.
  run [options]      Capture, diff against the baselines and publish a build
                     (what CI calls).
  help [command]     display help for command
```
<!-- /cli-help -->

## `targus capture`

Captures every story to a directory: one `<storyId>.png` per story plus `manifest.json`. Works
offline: nothing is uploaded and no token is needed.

```sh
targus capture --udid <simulator-udid> --app build/MyApp.app --out visual/current
```

`--udid`, `--app` and `--out` are required.

<!-- cli-help: capture -->
```text
Usage: targus capture [options]

Capture every story to a directory with a manifest.json (works offline).

Options:
  --udid <id>             ios: simulator UDID (xcrun simctl list devices)
  --app <path>            ios: path to the built simulator .app
  --out <dir>             output directory
  --platform <list>       ios, web or both, e.g. ios,web (default: the config,
                          else ios)
  --config <path>         project config file (default: targus.config.ts or
                          .json, if present)
  --storybook <dir|url>   web: built Storybook directory, or the URL of one
  --viewport <WxH>        web: browser viewport in CSS pixels (default:
                          1200x900)
  --pixel-ratio <n>       web: device pixels per CSS pixel (default: 1)
  --appearance <mode>     simulator light or dark mode, set before launch
                          (default: light) (choices: "light", "dark")
  --bundle-id <id>        bundle id (default: read from the app Info.plist)
  --port <n>              Storybook channel port the app connects to (default:
                          7007)
  --settle <ms>           wait after storyRendered before the first screenshot
                          (default: 300)
  --stability-gap <ms>    gap between the two stability screenshots (default:
                          150)
  --render-timeout <ms>   how long to wait for storyRendered (default: 10000)
  --connect-timeout <ms>  how long to wait for the app to connect (default:
                          60000)
  --attempts <n>          stability attempts, settle doubling each time
                          (default: 3)
  --filter <text>         only stories whose id or title contains this text
  --limit <n>             capture at most this many stories
  -h, --help              display help for command
```
<!-- /cli-help -->

Before the first story, the CLI boots the simulator (an already booted one is fine), switches off
the simulator services that post system notices such as "Ready for Apple Intelligence", puts the
simulator in light or dark mode (`--appearance`, default `light`), and sets the status bar to 9:41
with full battery and signal. A simulator that has never booted is booted twice, about 15 to 30
seconds extra once, because its first boot queues that notice before the CLI can stop it. Leave
the simulator shut down before targus runs, so it can tell a first boot.

The appearance is set before the app is installed and launched, so the app starts in that mode
and needs no extra wait. It is pinned on every run because the simulator remembers whatever it
was last set to, from Xcode, a person or an earlier run, and an app whose theme follows the system
would otherwise be captured in that. `manifest.json` records it as `summary.device.appearance`.
To review dark mode as well, publish it to a second targus project with its own token, from a
second CI job that passes `--appearance dark`. Baselines are picked per project and commit, not
per device or appearance, so light and dark builds in one project would be diffed against each
other.

For each story the CLI selects it over the Storybook channel, waits for `storyRendered`, waits
`--settle` milliseconds, then takes two screenshots `--stability-gap` apart. When they differ it
tries again with the settle time doubled, up to `--attempts` times; a story that never holds
still is recorded as `unstable` instead of failing the run. A story can set its own wait or be
left out with [story parameters](story-parameters.md).

## `targus compare`

Diffs a capture against a baseline capture and writes `report.json`, `report.html` and
`<storyId>.diff.png` files. Informational: it never fails on changes.

```sh
targus compare --current visual/current --baseline visual/baseline --out visual/report
```

<!-- cli-help: compare -->
```text
Usage: targus compare [options]

Diff a capture against a baseline capture and write an HTML report.

Options:
  --current <dir>      capture directory to check
  --baseline <dir>     capture directory to compare against
  --out <dir>          report directory
  --threshold <ratio>  changed-pixel ratio above which a story changed (default:
                       0.001)
  -h, --help           display help for command
```
<!-- /cli-help -->

`--threshold` (default `0.001`, 0.1% of pixels) is the changed-pixel ratio above which a story
counts as changed. Only `compare` takes it: `targus run` diffs with the threshold the server sends
when it opens the build, and refuses a `--threshold` flag.

## `targus run`

What CI calls. Captures (or loads a previous capture), opens a build on the targus API, downloads
only the baselines whose hash differs, diffs them locally, uploads the images the server is
missing plus the diff images, and submits every story's result. It prints the build id on its own
`build: <id>` line (for scripts), a count per state, the review URL and the GitHub check run id.

```sh
# Capture and publish
TARGUS_TOKEN=... targus run --udid <simulator-udid> --app build/MyApp.app

# Publish a capture made earlier with `targus capture`
TARGUS_TOKEN=... targus run --from-capture visual/current --device-name "iPhone 16"
```

<!-- cli-help: run -->
```text
Usage: targus run [options]

Capture, diff against the baselines and publish a build (what CI calls).

Options:
  --udid <id>             simulator UDID (not needed with --from-capture)
  --app <path>            path to the built simulator .app (not needed with
                          --from-capture)
  --out <dir>             where to write the capture (default: a temp directory)
  --from-capture <dir>    skip the simulator and use a `targus capture`
                          directory
  --api-url <url>         targus API base URL, http or https (default: env
                          TARGUS_API_URL, else http://localhost:8787)
  --device-name <name>    device the build is for (default: the simulator name)
  --base-branch <branch>  default branch; a build on it without a PR is main
                          (default: "main")
  --branch <name>         branch (default: from CI env, then git)
  --pr <n>                pull request number (default: from CI env)
  --sha <sha>             commit of the build (default: git rev-parse HEAD)
  --platform <list>       ios, web or both, e.g. ios,web (default: the config,
                          else ios)
  --config <path>         project config file (default: targus.config.ts or
                          .json, if present)
  --storybook <dir|url>   web: built Storybook directory, or the URL of one
  --viewport <WxH>        web: browser viewport in CSS pixels (default:
                          1200x900)
  --pixel-ratio <n>       web: device pixels per CSS pixel (default: 1)
  --appearance <mode>     simulator light or dark mode, set before launch
                          (default: light) (choices: "light", "dark")
  --bundle-id <id>        bundle id (default: read from the app Info.plist)
  --port <n>              Storybook channel port the app connects to (default:
                          7007)
  --settle <ms>           wait after storyRendered before the first screenshot
                          (default: 300)
  --stability-gap <ms>    gap between the two stability screenshots (default:
                          150)
  --render-timeout <ms>   how long to wait for storyRendered (default: 10000)
  --connect-timeout <ms>  how long to wait for the app to connect (default:
                          60000)
  --attempts <n>          stability attempts, settle doubling each time
                          (default: 3)
  --filter <text>         only stories whose id or title contains this text
  --limit <n>             capture at most this many stories
  -h, --help              display help for command
```
<!-- /cli-help -->

The build records the appearance its stories were captured in, shown next to the device in the
review UI. With `--from-capture` it is the one in the capture's `manifest.json`, and
`--appearance` is not used.

There is no `--threshold`: the server owns the diff threshold, sends it when the build opens, and
refuses results diffed with any other one.

The project token is read only from `TARGUS_TOKEN`. There is deliberately no flag, so it never
lands in shell history or CI logs.

### Checks before anything slow

Before the git work and before the simulator boots, `targus run` checks what it can in seconds:
the flags and environment, the simulator's name, that `--app` is a directory with an `Info.plist`
holding a `CFBundleIdentifier` (unless `--bundle-id` is given), and the token, by asking the API
which project it belongs to. It then prints `project: <name> (<owner/repo>)`. A token the API
rejects exits `3`; an address that is not a targus API exits `1`. `targus capture` makes no API
call.

After capturing, a capture with no stories exits `1` before a build is opened, since an empty
build would mark every baseline story removed, pass the check and, on the default branch, become
the next baseline. When the story index was empty (a broken `stories` glob, an app built without
Storybook, or a `--filter` that matched nothing) the error says so; when every story was left out
by `parameters.targus.skip` it says that instead. The API refuses an empty results submission too.

### Branch, pull request and baseline

Branch and PR number come from CircleCI (`CIRCLE_BRANCH`, `CIRCLE_PULL_REQUEST`,
`CIRCLE_PR_NUMBER`) or GitHub Actions (`GITHUB_HEAD_REF`, `GITHUB_REF_NAME`, `GITHUB_REF`);
`--branch` and `--pr` override them. A build on `--base-branch` without a PR is a `main` build;
everything else is a `pr` build. `targus run` fetches `origin/<base-branch>` and sends the merge
base with its first 100 first-parent ancestors, so the server can pick the baseline (see
[How baselines work](../guide/review.md#how-baselines-and-approvals-work)).

This needs the full git history. A shallow clone stops before the merge base, so every story
would come out `new` with nothing compared; `targus run` refuses one up front instead:

- GitHub Actions: set `fetch-depth: 0` on `actions/checkout` (its default is `1`).
- CircleCI: the `checkout` step clones the full history already.
- Elsewhere: run `git fetch --unshallow` before `targus run`.

If the fetch of the base branch fails but `origin/<base-branch>` or a local `<base-branch>`
exists (a laptop offline, or a checkout without `origin`), `targus run` prints a warning and uses
it; if neither exists it stops.

`--sha` replaces only the commit the build and its check run are for; the merge base is still
computed from `HEAD`. GitHub Actions `pull_request` workflows must pass it, because there
`actions/checkout` checks out a synthetic merge commit that is not on the PR:

```yaml
- run: npx targus run --udid "$UDID" --app build/MyApp.app --sha ${{ github.event.pull_request.head.sha || github.sha }}
  env:
    TARGUS_TOKEN: ${{ secrets.TARGUS_TOKEN }}
```

CircleCI checks out the PR head itself, so `HEAD` is already right there.

## Timeouts and retries

Nothing waits forever, so a hung simulator or a stalled network fails the job with a message
instead of running into the CI runner's own limit:

- Every `xcrun simctl`, `git` and `plutil` call has a timeout: `bootstatus` 5 minutes, an install
  3 minutes, `git fetch` 5 minutes, everything else between 30 seconds and a minute. A call that
  runs over is stopped and the run fails with `error: <command> did not finish within <time> and
was stopped`.
- Every API request is aborted after 60 seconds, body included.
- `--connect-timeout` bounds the wait for the app to connect to the channel.
- The app is watched for the whole capture. A crash at launch stops the run within about a
  second; a crash mid-run stops it straight away. The stories captured before the crash are
  discarded: `targus capture` writes no output and `targus run` opens no build, since a partial
  build would show the rest as removed.
- Opening the build, image uploads, image downloads and the results submission are retried up to
  four times, 0.5 s, 1 s and 2 s apart, on network errors, timeouts, 429 and 5xx, never on other
  4xx. Each retry prints a `warning:` line. Retries are safe: uploads are content-addressed, the
  server stores a build's results only once, and a retry of opening a build gets the build the
  first attempt opened.

## Environment

| Variable         | Used by       | Meaning                                       |
| ---------------- | ------------- | --------------------------------------------- |
| `TARGUS_TOKEN`   | `targus run`  | project token (required)                      |
| `TARGUS_API_URL` | `targus run`  | API base URL, default `http://localhost:8787` |
| CI variables     | `targus run`  | branch and PR detection, see above            |
| `TARGUS_DEBUG`   | every command | `1` or `true` adds stack traces to errors     |

The environment is read only when `targus run` starts, so `--help` and `--version` work with
nothing set. The variables and `--api-url` are checked before git, the simulator or the API is
touched, so a typo costs a second, not a capture. An empty `TARGUS_TOKEN` counts as missing.

The API URL (`--api-url`, else `TARGUS_API_URL`, else `http://localhost:8787`) must be an
`http://` or `https://` URL with no user name or password and no `?query` or `#fragment`.
Trailing slashes are dropped. A path prefix is kept for an API behind a proxy:
`https://example.com/targus` sends `https://example.com/targus/api/builds`. A URL ending in `/api`
is rejected, since targus adds `/api` itself. `--api-url` wins over `TARGUS_API_URL`.

## Errors

A failed command prints a few plain lines on stderr: what failed and, where the cause is known,
what to do about it:

```text
error: POST /api/builds: cannot reach http://localhost:8787
  connection refused: 127.0.0.1:8787
  check the API URL (TARGUS_API_URL or --api-url) and that the targus API is reachable
```

[Troubleshooting](../guide/troubleshooting.md) lists the messages by what you see. Anything
unexpected is reported as `error: unexpected error: <message>`, which is probably a bug in
targus. Set `TARGUS_DEBUG=1` to append the stack of the error and of every cause.

## Exit codes

| Code | Meaning                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | the command completed. For `run` that includes builds with changes pending review: the `targus/ios` GitHub check is what gates the merge, not the CI step      |
| `1`  | the command failed: invalid arguments or environment, capture failure, API or network error, bad response, missing file or command, unexpected error          |
| `2`  | the command is not implemented                                                                                                                                |
| `3`  | the API rejected the project token (`TARGUS_TOKEN` missing, wrong, or not allowed)                                                                            |

`--help` and `--version` exit `0`.
