# Run targus in GitHub Actions

One job, on every pull request and every push to `main`:

- **Pull requests** get a `targus/ios` check that stays pending until each visual change is
  approved.
- **Pushes to `main`** become the baseline for later pull requests, with the approvals from the
  merged PR applied.

The job builds the native simulator app only when native code changes, and otherwise just
re-bundles the JavaScript into a cached copy. Expect roughly a second per story, plus a few minutes
of setup.

**Before you start:** [prepare your app](prepare-your-app.md) (the decorator, the Storybook switch
and the two build scripts), and have a project token. The [CI prompt](../prompts/add-github-actions.md)
has an AI agent write this workflow for your repository.

## 1. Add the secret and the URL

In the repository's **Settings → Secrets and variables → Actions**:

- a secret `TARGUS_TOKEN` holding the project token;
- the workflow below sets `TARGUS_API_URL` to your targus service's address. Change it, or make
  it a repository variable.

## 2. Add the workflow

Save as `.github/workflows/targus.yml`, then replace `MyApp` with your app's name (the same one as
in `scripts/build-ios-sim.sh`) and `https://<targus host>` with your service's address:

```yaml
name: targus

on:
  push:
    branches: [main]
  pull_request:

# A newer push to a pull request replaces the run in progress. A build on main is never
# cancelled: later pull requests need it as their baseline.
concurrency:
  group: targus-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

permissions:
  contents: read

env:
  TARGUS_API_URL: https://<targus host>
  DEVICE_TYPE: iPhone 16
  APP: build/MyApp.app

jobs:
  visual-ios:
    # Pin the image: another Xcode or iOS runtime renders text and shadows a little
    # differently, and every story would show as changed.
    runs-on: macos-26
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # targus run needs the history to find the merge base with main

      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: corepack enable
      - run: yarn install --immutable

      # The native app changes only when native inputs do (Expo SDK, native modules, app.json).
      # Its Expo fingerprint plus the Xcode version is the cache key.
      - name: Fingerprint the native app
        id: fingerprint
        run: |
          hash=$(npx @expo/fingerprint fingerprint:generate --platform ios | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>console.log(JSON.parse(s).hash))')
          xcode=$(xcodebuild -version | awk 'NR==2 {print $3}')
          echo "key=targus-ios-app-v1-xcode-$xcode-$hash" >> "$GITHUB_OUTPUT"

      - name: Restore the simulator app
        id: app-cache
        uses: actions/cache/restore@v4
        with:
          path: ${{ env.APP }}
          key: ${{ steps.fingerprint.outputs.key }}

      - name: Build the simulator app on a fingerprint miss
        if: steps.app-cache.outputs.cache-hit != 'true'
        run: bash scripts/build-ios-sim.sh

      - name: Save the simulator app
        if: steps.app-cache.outputs.cache-hit != 'true'
        uses: actions/cache/save@v4
        with:
          path: ${{ env.APP }}
          key: ${{ steps.fingerprint.outputs.key }}

      - name: Re-bundle the JavaScript and swap it into the app
        run: bash scripts/bundle-js.sh

      # Create the simulator, but leave it shut down: `targus run` boots it and keeps system
      # notices, such as "Ready for Apple Intelligence", out of the screenshots. No wait is needed.
      - name: Create the simulator
        id: simulator
        run: |
          udid=$(xcrun simctl create targus-ci "$DEVICE_TYPE")
          echo "udid=$udid" >> "$GITHUB_OUTPUT"

      - name: Capture and publish
        env:
          TARGUS_TOKEN: ${{ secrets.TARGUS_TOKEN }}
        run: |
          npx targus run \
            --udid "${{ steps.simulator.outputs.udid }}" \
            --device-name "$DEVICE_TYPE" \
            --app "$APP" \
            --out visual/current \
            --connect-timeout 120000 \
            --sha "${{ github.event.pull_request.head.sha || github.sha }}"

      - name: Upload the capture
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: targus-capture
          path: visual/current
          if-no-files-found: ignore
          retention-days: 7
```

Why the less obvious lines are there:

- **`fetch-depth: 0`.** `targus run` finds the commit your branch started from to pick the
  baseline, and refuses a shallow clone, which would make every story `new`.
- **`--sha`.** On `pull_request` events `actions/checkout` checks out a synthetic merge commit.
  The check run has to land on the PR's head commit, or it does not show on the PR.
- **`--device-name`.** It is recorded on the build. Baselines are not kept per device yet, so
  capture every build on the same device type and iOS runtime, or each switch shows every story
  as changed.
- **`--connect-timeout 120000`.** The first launch of a freshly installed app on a cold CI
  simulator can take longer than the default minute.
- **`runs-on: macos-26`.** Its default Xcode has to be one your Expo SDK supports; check the
  image's Xcode list in [actions/runner-images](https://github.com/actions/runner-images), and
  select another installed Xcode with `sudo xcode-select -s` in a step if needed.
- **Pull requests from forks** get no secrets, so `targus run` stops with `TARGUS_TOKEN is not
  set`. Skip the job for them with
  `if: github.event.pull_request.head.repo.full_name == github.repository || github.event_name == 'push'`
  on the job, or accept the failure.
- **The job passes even when stories changed.** `targus run` exits `0` with changes pending; the
  `targus/ios` check is what gates the merge, not the job. The job fails only when the capture or
  the upload fails, or a story throws while rendering.

### In a monorepo

When the app is a package such as `apps/storybook`, the scripts, `build/` and `visual/` live
there. Set the job's default working directory, and prefix the paths that actions (not `run:`
steps) resolve from the repository root:

```yaml
    defaults:
      run:
        working-directory: apps/storybook
    # ...in actions/cache/restore, actions/cache/save and actions/upload-artifact:
    #   path: apps/storybook/${{ env.APP }}   and   path: apps/storybook/visual/current
```

Install dependencies from the repository root (`working-directory: .` on that step), and run
the CLI with the app's own script runner, for example `yarn workspace <app package name> targus run ...`.

## 3. Open a pull request

1. Merge the workflow to `main` first, or push to `main` once: the first `main` build is the
   baseline, and every story in it is `new`.
2. Open a pull request that changes a component. The job's log ends with a count per state and a
   review URL, and the PR shows the `targus/ios` check: "3 changes awaiting review".
3. Follow the check's **Details** link, sign in with GitHub and [review the changes](review.md).
   The check turns green when every change is approved.

## 4. Make the check required

Once the team trusts the results (a week of informational runs is a good start), add `targus/ios`
to the branch protection rule or ruleset for `main` as a required status check. From then on a
pull request with unreviewed or denied visual changes cannot merge.

## Self-hosted Mac runners

A self-hosted runner keeps its state between jobs, so:

- Create the simulator once under a unique name and reuse it, rather than creating one per job;
  shut it down at the end of the job (`if: always()`).
- Keep a single iOS runtime for it. Two simulators named "iPhone 16" on different runtimes render
  differently.
- Make sure nothing else listens on port 7007, the Storybook channel port, when the job starts.
- Run one targus job at a time per machine: two captures cannot share the port.

## Until the packages are on npm

Check out the targus repository beside yours and build the two packages there, as
[Prepare your app](prepare-your-app.md#1-install-the-packages) describes. The targus repository
is public, so the checkout needs no key; pin it with `ref:` to a commit you have tested, or every
change to targus reaches your CI at once. Check out both repositories side by side, set `working-directory: my-app` as the job default (or on each
step), and add the build before `yarn install`:

```yaml
    defaults:
      run:
        working-directory: my-app
    steps:
      - uses: actions/checkout@v4
        with:
          path: my-app
          fetch-depth: 0
      - uses: actions/checkout@v4
        with:
          repository: maxcwolf/targus
          ref: <a tested targus commit>
          path: targus
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: corepack enable
      - name: Build the targus packages
        working-directory: targus
        run: |
          yarn workspaces focus @targus/cli @targus/react-native
          yarn workspace @targus/cli build
          yarn workspace @targus/react-native build
      - run: yarn install --immutable
      # ...the remaining steps as above, with paths under my-app/ for the cache and the artifact
```

Run the CLI as `yarn targus run ...` instead of `npx targus run ...`.

## Other CI providers

[CircleCI](ci-circleci.md) has its own recipe. Anywhere else, the job is the same five steps:
full git history, build or restore the simulator app, re-bundle the JavaScript, create a simulator
(left shut down: targus boots it), and `targus run` with `TARGUS_TOKEN` set and the branch and PR number passed as `--branch` and
`--pr` (the CLI reads them from the environment only on GitHub Actions and CircleCI).
