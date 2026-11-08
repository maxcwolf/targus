# Troubleshooting

Find the message you see, then the fix. Every targus error starts with `error:`, and most come
with a second, indented line saying what to do. For the full stack of any error, run the command
again with `TARGUS_DEBUG=1`.

Exit codes: `1` is any failure, `3` means the API rejected the project token. A run with changes
waiting for review exits `0`: the `targus/ios` check gates the merge, not the CI step.

## The app never connects

```text
error: the app did not connect within 60s on port 7007: check that it launched, was bundled with EXPO_PUBLIC_TARGUS=true and uses this port, or raise --connect-timeout
```

The app launched but never opened the Storybook channel. In order of likelihood:

1. **The bundle was built without `EXPO_PUBLIC_TARGUS=true`** (or without
   `EXPO_PUBLIC_STORYBOOK_ENABLED=true`), so the app is not in capture mode. Rebuild or
   re-bundle with both set; see [Build the simulator app](prepare-your-app.md#5-build-the-simulator-app).
2. **`enableWebsockets` is not on** in `.rnstorybook/index.tsx`; see
   [Switch Storybook into capture mode](prepare-your-app.md#3-switch-storybook-into-capture-mode).
3. **The app uses another port.** Pass the same number with `--port`.
4. **A cold simulator is slow.** A fresh CI simulator can take longer than a minute to launch the
   app: pass `--connect-timeout 120000`.

```text
error: unexpected error: timeout after 60000ms waiting for RN_GET_INDEX_RESPONSE
```

Despite the "unexpected error" wording, this is usually not a bug in targus: something connected
to the channel but never answered with a list of stories. Check that the app boots into on-device
Storybook, and that no other Storybook server or tool is using the port.

## The app crashes

```text
error: the app com.example.myapp exited before any story was captured, probably a crash at launch: look for its crash report in ~/Library/Logs/DiagnosticReports
error: the app com.example.myapp exited after 41 of 120 stories, probably a crash: look for its crash report in ~/Library/Logs/DiagnosticReports; the partial capture was discarded
error: the app com.example.myapp closed its Storybook channel connection after 41 of 120 stories; the partial capture was discarded
```

Open the newest `.ips` file for your app in `~/Library/Logs/DiagnosticReports` (on CI, upload
that folder as an artifact). A crash at launch is usually native: a missing native module in the
cached app (rebuild it), or an iOS runtime the app does not support yet. A crash mid-run points
at the story after the last one in the log. Nothing is published from a partial capture.

## There is nothing to compare

```text
error: the capture had no stories, so there is nothing to compare: check the `stories` glob in .rnstorybook/main and that the app was built with Storybook and its regenerated storybook.requires, or loosen --filter if the capture used one
error: no story matched --filter "Button", or the story index had none, so there is nothing to compare: loosen --filter, or check the `stories` glob in .rnstorybook/main and that the app was built with Storybook and its regenerated storybook.requires
error: all 12 stories are skipped by `parameters.targus.skip`, so there is nothing to compare: capture at least one story
```

`targus run` refuses a capture with no stories before it opens a build. An empty build would mark
every accepted story `removed`, which needs no review, so the check would pass and, on the default
branch, the empty build would become the baseline. Check the `stories` glob in
`.rnstorybook/main.ts`, that `storybook.requires.ts` was regenerated before the bundle was built,
and the `--filter` you passed. If every story is skipped, remove `skip` from at least one, or from
`.rnstorybook/preview.tsx` if it is set there for all of them.

## The screenshots look wrong

| You see                                                    | Why, and the fix                                                                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| The Storybook sidebar or addons panel                      | The bundle was built without `EXPO_PUBLIC_TARGUS=true`, so `onDeviceUI` is on.                                                               |
| `blank (3): ...` in the summary, single-colour images      | The screenshot was taken before the story drew. Give those stories a [`delay`](../reference/story-parameters.md), or raise `--settle`.       |
| A system notification over the app                         | targus silences the "Ready for Apple Intelligence" notice when it boots the simulator. If it still shows, the simulator was booted before targus ran: shut it down and run again. Any other notice is not handled yet. |
| Every story changed, by a little                           | The capture environment moved: another Xcode, iOS runtime or device. Pin them; see [Review](review.md#when-everything-changed-at-once). Compare the device and appearance on the two builds: a baseline captured in the other light or dark mode changes every story whose theme follows the system. |
| A story differs on every run                               | The story is not deterministic: the current date, random data, a remote image, an animation. See [Make stories deterministic](prepare-your-app.md#4-make-stories-deterministic). |

## A story is `unstable`, `error` or `skipped`

The capture prints one line per story and a summary at the end.

- **`UNSTABLE after 3 attempts`**: two screenshots taken `--stability-gap` apart never matched,
  even after doubling the wait. Usually a looping animation. Use `parameters.targus.skip`, a
  `delay`, or a still frame under targus. Unstable stories never block the check, and their
  capture never replaces the baseline.
- **`ERROR <message>`**: the story threw while rendering, and the message is the app's own error
  (for example `No QueryClient set`). Give the story the providers it needs. Errors fail the build.
- **`ERROR timeout after 10000ms waiting for storyRendered <storyId>`**: the story never finished
  rendering. Something in it suspends or waits on the network. Raise `--render-timeout` only if it
  really is slow.
- **`ERROR invalid parameters.targus: delay: Too big: expected number to be <=10000`**: a story
  parameter has the wrong type or is out of range. See [Story parameters](../reference/story-parameters.md).
- **`SKIPPED (parameters.targus.skip)`**: the story asked to be left out. Not an error.

## The token is rejected (exit 3)

```text
error: TARGUS_TOKEN is not set: export the project token
error: TARGUS_TOKEN is empty: export the project token
error: the targus API at https://<targus host> rejected TARGUS_TOKEN: export the token printed when the project was created (a revoked token, or one whose project was deleted, is rejected)
```

The token is read only from `TARGUS_TOKEN`; there is no flag. In GitHub Actions, check that the
secret exists and is passed to the step with `env: TARGUS_TOKEN: ${{ secrets.TARGUS_TOKEN }}`.
Secrets are not passed to workflows triggered from forks. A rejected token is wrong, revoked, or
belongs to a deleted project: ask your targus admin for a new one.

## The API is unreachable or is not targus

```text
error: GET /api/projects/current: cannot reach https://<targus host>
  host not found: <targus host>
  check the API URL (TARGUS_API_URL or --api-url) and that the targus API is reachable
```

Check `TARGUS_API_URL` (or `--api-url`). Without either, the CLI talks to
`http://localhost:8787`, the local development server, which is rarely what you want in CI.

```text
error: https://example.com does not answer GET /api/projects/current: check that --api-url or TARGUS_API_URL is the targus API, and that it runs a version as new as this CLI
```

The address answers, but it is not the targus API, or the service is older than your CLI. Give
the service's root address, without `/api` at the end.

```text
error: TARGUS_API_URL "targus.example.com" has no http:// or https:// scheme
  set --api-url or TARGUS_API_URL to the targus API's address, for example https://targus.example.com
```

The URL itself is malformed. Other reasons in the same form: `ends in /api, which targus adds
itself`, `has a ?query or #fragment`, `contains a user name or password; the token belongs in
TARGUS_TOKEN`.

```text
warning: POST /api/builds failed with 503: Service Unavailable; retrying in 1s (attempt 3 of 4)
```

Not an error yet: network failures, timeouts, 429 and 5xx are retried up to four times. The run
fails with `(gave up after 4 attempts)` only when the last attempt fails too.

## Git: shallow clone, base branch, detached HEAD

```text
error: this checkout is a shallow clone, so targus cannot find the merge base with the base branch or its ancestors, and every story would be reported as new. Fetch the full history: ...
```

On GitHub Actions, set `fetch-depth: 0` on `actions/checkout`. Elsewhere, run
`git fetch --unshallow` before `targus run`.

```text
error: cannot find the base branch main: origin has no such branch and there is no local main; pass --base-branch
```

Your default branch has another name: pass it, for example `--base-branch master`.

```text
error: cannot tell the branch (detached HEAD): pass --branch
```

Your CI checks out a commit, not a branch, and is not GitHub Actions or CircleCI (whose variables
targus reads). Pass `--branch` and, for pull requests, `--pr`.

```text
warning: could not fetch main from origin; using origin/main, which may be stale
```

The run continues against your local copy of the base branch. Fine on a laptop offline; on CI,
check the runner's network and credentials.

## The check run does not appear on the PR

The last lines of `targus run` say what happened to the check run:

| Line                                                                          | Meaning                                                                                                     |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `check run: <id>`                                                             | Created. If it is not on the PR, it is on another commit: pass `--sha` with the PR's head commit (GitHub Actions `pull_request` runs). |
| `check run: none (the project has no GitHub App installation)`                | Ask your targus admin to install the targus GitHub App on the repository's account or org and record the installation on the project. |
| `check run: none (the server has no GitHub App configured)`                   | The targus service itself has no GitHub App set up. An admin issue.                                         |
| `check run: still being created by an earlier attempt or a review`            | A retried submission or a review is creating it right now. Nothing to do: it appears on the PR shortly. |
| `check run not created: GitHub failed; the next review of this build creates it` | GitHub was unavailable. Nothing to do: the first review decision on the build creates it.              |
| `check run not created: GitHub failed; run targus run again to retry`         | GitHub was unavailable and the build has nothing to review, so no review will create it. Re-run the job. |

## The simulator and the app bundle

```text
error: no simulator with UDID <udid> in `xcrun simctl list devices`: check --udid, or pass --device-name
error: xcrun simctl boot <udid> failed: Invalid device or device pair: <udid>
```

UDIDs differ on every machine. Find yours with `xcrun simctl list devices available`, or create
one in the job, as the [CI guide](ci-github-actions.md) does.

```text
error: could not read the simulator list: its output is not JSON (it starts with "xcrun: warning: ...")
```

Run `xcrun simctl list devices --json` yourself to see what it prints, and check that
`xcode-select -p` points at the Xcode you expect.

```text
error: --app build/MyApp.app does not exist: pass the .app directory built for the iOS simulator
error: --app build/MyApp.app has no Info.plist: pass the .app directory built for the iOS simulator
```

`--app` is the `.app` directory from a **simulator** build (`-sdk iphonesimulator`), not an
`.ipa`, an archive or a device build. `targus capture` shows the same problem as a raw `plutil`
error (`plutil -extract CFBundleIdentifier ... failed`).

```text
error: command not found: xcrun
  install Xcode and its command line tools (xcode-select --install)
```

```text
error: port 7007 is already in use
  stop the other process using it (another targus or Storybook server?) or pass --port
```

Another capture or a Storybook server holds the channel port. Find it with
`lsof -nP -iTCP:7007 -sTCP:LISTEN`. On a self-hosted runner, stop leftovers at the end of each job.

```text
error: xcrun simctl bootstatus <udid> -b did not finish within 5m and was stopped
```

The simulator hung while booting. Delete and recreate it (`xcrun simctl delete <udid>`); on a
self-hosted runner, check free disk space.

```text
error: the first boot of simulator <udid> did not finish; shut it down with `xcrun simctl shutdown <udid>` if it is still booted, then run again
warning: could not stop system/com.apple.followupd; its notices may reach screenshots: ...
```

On a simulator's first boot, targus switches off the services that post system notices, then
reboots it. The error means that sequence failed partway; once the simulator is shut down, the
next run's boot finishes the job. The warning means the simulator refused to stop one of those
services. The capture goes on, so check its first screenshots for a banner.

## Results the server refuses

```text
error: POST /api/builds/<id>/results failed with 409: the results were diffed with threshold 0.001, but the server classifies with 0.002: run `targus run` again
```

The service's diff threshold changed while your build was open. Run again.

```text
error: POST /api/builds/<id>/results failed with 409: build <id> already has other results; the build already has different results, from another submission
```

Something else stored different results for this build first. A retry of the same submission is
not refused (the service answers it as it did the first time), so this is not a lost response.
Run `targus run` again: every run opens a new build.

```text
error: POST /api/builds/<id>/results failed with 400: ✖ Invalid input: expected string, received undefined
  → at results[0].baselineHash
```

The CLI is older than the service: since `@targus/cli` sends the baseline each story was diffed
against, the service refuses results without it. Upgrade `@targus/cli` to match the service.

```text
error: PUT /api/images/<hash> failed with 413: image larger than 10 MB
```

A screenshot is over the 10 MB upload limit, which a normal phone screen never reaches. Check
that the story is not rendering something unusually large.

## Captures on disk (`compare`, `--from-capture`)

```text
error: file or directory not found: visual/current/manifest.json
error: visual/current/manifest.json is not valid JSON: is it a targus capture?
error: visual/current/button--primary.png does not match its manifest hash; the capture in visual/current was modified
```

Point the flag at a directory written by `targus capture`, and do not edit its files.
`error: unexpected error: Invalid file signature` also means a damaged PNG in a capture
directory: capture again.

## Still stuck

Run again with `TARGUS_DEBUG=1` and keep the full output. Errors from the service include a
`(request id: ...)`; quote it when you report the problem. You can also paste the log into an AI
agent with the [debugging prompt](../prompts/README.md#debug-a-failed-run).
