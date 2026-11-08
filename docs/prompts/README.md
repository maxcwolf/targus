# Set up targus with an AI agent

These prompts have a coding agent such as Claude Code or Codex do the targus setup in your app's
repository. Start the agent in the repository, open a prompt (each one is folded; click its title),
copy it with the button on the top right of the block, paste it, and read the report it ends with.

| Step | Prompt                                               | What it does                                                                      |
| ---- | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1    | [Prepare my app](setup-app.md)                       | installs the packages, adds the decorator, capture mode and the build scripts     |
| 2    | [Build and run my first capture](first-capture.md)   | builds the simulator app, captures a few stories, checks the screenshots          |
| 3    | [Add the GitHub Actions job](add-github-actions.md)  | writes `.github/workflows/targus.yml` for your repository                         |
| any  | [Fix a flaky story](#fix-a-flaky-story)              | makes one story render the same on every run                                      |
| any  | [Debug a failed run](#debug-a-failed-run)            | explains a failed `targus capture` or `targus run` log and proposes the fix       |

Every prompt is written the same way:

- **It carries what the agent needs.** Codex and some Claude Code setups have no network access,
  so the facts are in the prompt rather than behind a link.
- **It looks before it changes anything** and tells you what it found: Expo or bare, the
  Storybook version, the package manager.
- **It changes only what it lists**, and asks before adding a dependency or touching a story.
- **It never handles your token.** You add `TARGUS_TOKEN` yourself, as a CI secret.
- **It ends with a check and a report**: what changed, what it ran, what it could not verify.

## Fix a flaky story

Use this when a story shows as changed (or `unstable`) in builds where nobody changed it. Replace
the story id with yours; it is the PNG's file name in the capture.

<details>
<summary><strong>Prompt: Fix a flaky story</strong> (click to open, then copy)</summary>

```text
The Storybook story <story id, e.g. components-card--with-date> renders differently from one
targus capture to the next, so targus reports a visual change nobody made. targus screenshots
each story in an iOS simulator after it renders, takes a second screenshot to check it holds
still, and compares pixels with the last accepted screenshot.

Find the story's file and everything it renders, and look for what can differ between two runs:
the current date or time, random values or generated ids, remote images or data, animations
(Animated, Reanimated, Lottie, layout animations), a focused input's blinking cursor, async state
that finishes after the first render. Tell me the cause, with the file and line.

Then propose the smallest fix, in this order of preference:
1. make the story deterministic: fixed props, local fixtures, a frozen clock in
   .rnstorybook/preview.tsx when process.env.EXPO_PUBLIC_TARGUS === 'true';
2. for an animation that plays once: parameters: { targus: { delay: <ms> } } on the story
   (0 to 10000, a little longer than the animation);
3. for an animation that never stops: parameters: { targus: { skip: true } }.
Ask me before changing a component (as opposed to the story) or adding a dependency. Make the
change, run the type check, and give me the command to capture just this story:
  npx targus capture --udid <udid> --app build/<Name>.app --out visual/current --filter <story id>
```

</details>

## Debug a failed run

Paste the prompt, then the end of the failing log (the last 100 lines are usually enough). Remove
anything secret from the log first; targus itself never prints the token.

<details>
<summary><strong>Prompt: Debug a failed run</strong> (click to open, then copy)</summary>

```text
This is the output of a failed targus run (visual capture of on-device Storybook stories in an iOS
simulator; `targus capture` captures offline, `targus run` also publishes to the targus service).
targus errors start with "error:" and usually have an indented second line saying what to do.
Exit code 3 means the service rejected TARGUS_TOKEN; 1 is any other failure; a run with changes
awaiting review exits 0.

Explain in two or three sentences what failed and why. Then look at this repository (the CI
workflow, scripts/build-ios-sim.sh, scripts/bundle-js.sh, .rnstorybook/index.tsx,
.rnstorybook/preview.tsx) for the cause, and propose the fix as a diff. Common causes:
- "did not connect": the bundle was built without EXPO_PUBLIC_TARGUS=true, enableWebsockets is
  off, or the port is not 7007;
- "shallow clone": actions/checkout needs fetch-depth: 0;
- "rejected TARGUS_TOKEN" or "TARGUS_TOKEN is not set": the secret is missing, not passed to the
  step, or revoked;
- "exited before any story was captured": the app crashes at launch;
- "cannot reach": TARGUS_API_URL is wrong or unset.
- "nothing to compare": the story index was empty (stories glob, storybook.requires not
  regenerated), --filter matched nothing, or every story has parameters.targus.skip.
Do not apply the fix until I confirm, and never print or write a token.

The log:
```

</details>

The full list of messages and their fixes is in [Troubleshooting](../guide/troubleshooting.md).
