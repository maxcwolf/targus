# Quickstart

From an app with on-device Storybook to your first targus capture in about 15 minutes, all on
your own Mac. Nothing is uploaded until the last, optional step.

> [!TIP]
> Prefer to have an AI agent do this? Paste the [setup prompt](../prompts/setup-app.md) into
> Claude Code or Codex in your app's repository.

**You need:** macOS with Xcode and an "iPhone 16" simulator, Node 22+, and a React Native app
whose on-device Storybook (`@storybook/react-native` 10+) already runs in the simulator. The
steps below are for Expo; [Prepare your app](prepare-your-app.md) covers bare React Native and
explains every step. In a monorepo, run everything from the app's own folder (see
[Prepare your app](prepare-your-app.md)), and use an Xcode release your Expo SDK supports.

## 1. Install

```sh
yarn add -D @targus/cli @targus/react-native
```

> [!IMPORTANT]
> The packages are not on npm yet. Until they are, follow
> [Install from a checkout](prepare-your-app.md#1-install-the-packages) instead, and run the CLI
> as `yarn targus` wherever this page says `npx targus`.

## 2. Wire it into Storybook

In `.rnstorybook/preview.tsx`, add the decorator first:

```tsx
import { withTargus } from '@targus/react-native';

const preview: Preview = {
  decorators: [withTargus /* , your other decorators */],
};
```

In `.rnstorybook/index.tsx`, switch the channel on and the on-device UI off when the app is built
for targus, keeping your other options:

```tsx
const isTargus = process.env.EXPO_PUBLIC_TARGUS === 'true';

const StorybookUI = view.getStorybookUI({
  // ...your existing options
  onDeviceUI: !isTargus,
  enableWebsockets: isTargus,
  shouldPersistSelection: !isTargus,
});
```

## 3. Build the simulator app

Copy `scripts/build-ios-sim.sh` from
[Build the simulator app](prepare-your-app.md#5-build-the-simulator-app), replace `MyApp` with
your Xcode scheme, and run it:

```sh
bash scripts/build-ios-sim.sh      # writes build/MyApp.app
```

It builds a Release simulator app with `EXPO_PUBLIC_STORYBOOK_ENABLED=true` and
`EXPO_PUBLIC_TARGUS=true`, so Storybook in capture mode is bundled in. The first build takes a few
minutes.

## 4. Capture

```sh
xcrun simctl list devices available | grep "iPhone 16"   # copy a UDID in parentheses
npx targus capture --udid <udid> --app build/MyApp.app --out visual/current --limit 3
open visual/current
```

You should see three full-screen PNGs, one per story, and a `manifest.json`. Drop `--limit 3` to
capture everything; expect about a second per story. Add `visual/` to `.gitignore`.

Something wrong? A Storybook sidebar in the screenshots means the app was built without
`EXPO_PUBLIC_TARGUS=true`; anything else, see [Troubleshooting](troubleshooting.md).

## 5. Publish a build (optional)

Publishing needs a project on a targus service.

### Get a project token

Sign in to the targus review UI with GitHub and choose **New project**:

1. Install the targus GitHub App on the account or org that owns the repository (the page links
   to it), giving it access to the repository. GitHub brings you back to targus afterwards.
2. Choose the repository and **Create project**.

The page then shows the project token, once. Keep it in a password manager or a CI secret, never
in a file in the repo. You can create a project when you are a member of the GitHub org that owns
the repository, or the owner of a personal account.

<details>
<summary>For the targus admin: creating a project without the UI</summary>

```sh
curl -s https://<targus host>/api/admin/projects \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"githubOrg":"my-org","installationId":12345678,"repo":"my-org/my-app","name":"my-app"}'
```

`installationId` is the id of the targus GitHub App's installation on `my-org` (the number at the
end of the installation's settings URL), or `null` until the App is installed; without it no check
runs are created. `defaultBranch` is optional and defaults to `main`. The `token` field of the
response is the project token. See [apps/api/README.md](../../apps/api/README.md#github-app-setup).

</details>

### Publish

```sh
export TARGUS_API_URL=https://<targus host>
read -rs TARGUS_TOKEN && export TARGUS_TOKEN    # paste the token; it is not echoed
npx targus run --from-capture visual/current --device-name "iPhone 16"
```

It prints `project: my-app (my-org/my-app)`, a count per state and a review URL. Open the URL and
sign in with GitHub to see the build.

> [!WARNING]
> A build published from `main` becomes the baseline for later pull requests. Let CI publish the
> baselines: screenshots from your Mac can differ from the CI runner's (another iOS runtime, other
> fonts), and every story would then show as changed.

## Next

- [Run it in CI](ci-github-actions.md) so every pull request gets a `targus/ios` check.
- [Make stories deterministic](prepare-your-app.md#4-make-stories-deterministic) before you trust
  the results.
- [Review changes](review.md): the review UI, and how baselines and approvals work.
