# Prompt: add the targus GitHub Actions job

Run this after your [first capture](first-capture.md) works. It writes
`.github/workflows/targus.yml` as described in [Run targus in GitHub Actions](../guide/ci-github-actions.md),
adapted to your repository. You add the `TARGUS_TOKEN` secret yourself; the agent never sees it.

Replace `https://<targus host>` with your targus service's address before you paste.

<details>
<summary><strong>Prompt: Add the targus GitHub Actions job</strong> (click to open, then copy)</summary>

```text
Add a GitHub Actions workflow that runs targus visual capture on every pull request and every push
to the default branch. targus is already set up in this repository: scripts/build-ios-sim.sh
builds build/<Name>.app (a Release iOS simulator app with Storybook in capture mode) and
scripts/bundle-js.sh re-bundles the JavaScript into it. If either is missing, stop and tell me.

First, tell me: the default branch name, the package manager and its install command, the Node
version the repo uses, whether it is an Expo app, and any existing workflow that already sets up
Node or caches dependencies (reuse its setup steps).

Then write .github/workflows/targus.yml with exactly these parts:
- on: push to the default branch, and pull_request.
- concurrency: group targus-${{ github.ref }}, cancel-in-progress only for pull_request
  (never cancel default-branch builds: they become the baseline).
- permissions: contents: read.
- env: TARGUS_API_URL: https://<targus host>, DEVICE_TYPE: iPhone 16, APP: build/<Name>.app.
- one job on runs-on: macos-26 (pinned, never macos-latest: another Xcode renders differently),
  timeout-minutes: 45, with these steps:
  1. actions/checkout@v4 with fetch-depth: 0 (targus refuses shallow clones).
  2. Node setup and dependency install, as the repo does it elsewhere.
  3. For Expo apps: an id'd step computing a cache key from
     `npx @expo/fingerprint fingerprint:generate --platform ios` (its JSON "hash") plus the Xcode
     build version from `xcodebuild -version`, written to $GITHUB_OUTPUT. For bare apps: hash the
     ios/ folder, the lockfile and package.json with hashFiles instead.
  4. actions/cache/restore@v4 of ${{ env.APP }} with that key; on a miss, run
     scripts/build-ios-sim.sh and then actions/cache/save@v4.
  5. Always run scripts/bundle-js.sh.
  6. Create a simulator with udid=$(xcrun simctl create targus-ci "$DEVICE_TYPE") and write udid
     to $GITHUB_OUTPUT. Do not boot it and do not sleep: targus run boots it and keeps system
     notices out of the screenshots.
  7. Capture and publish, with env TARGUS_TOKEN: ${{ secrets.TARGUS_TOKEN }}:
     npx targus run --udid <udid> --device-name "$DEVICE_TYPE" --app "$APP" --out visual/current
       --connect-timeout 120000 --sha "${{ github.event.pull_request.head.sha || github.sha }}"
     (use the package manager's script runner if package.json has a "targus" script).
  8. actions/upload-artifact@v4 of visual/current with if: always(), retention-days: 7.
Add a one-line comment on fetch-depth, --sha, the unbooted simulator and the pinned runner saying
why.

Rules: never put a token or secret value in any file; do not change other workflows; do not push.
Validate the YAML (actionlint if it is installed, otherwise a YAML parse).

Finish with the file, and tell me to:
1. add the repository secret TARGUS_TOKEN (Settings > Secrets and variables > Actions);
2. merge the workflow to the default branch first, so the first baseline exists;
3. open a test PR that changes one component and look for the targus/ios check.
```

</details>

After the first green run on `main`, open a pull request that changes a component: the
`targus/ios` check should say how many changes await review.
