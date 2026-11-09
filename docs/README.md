# targus documentation

targus is visual review for a React Native app's on-device Storybook: CI screenshots every story
in an iOS simulator, compares it with the accepted one, and holds a GitHub check until each change
is approved.

## Get started

- [What targus is](guide/overview.md): how it works, what you need, the words it uses.
- [Quickstart](guide/quickstart.md): your first capture on your own Mac in about 15 minutes.
- [Set up with an AI agent](prompts/README.md): copy-paste prompts for Claude Code or Codex.

## Guides

- [Prepare your app](guide/prepare-your-app.md): install, the decorator, capture mode,
  deterministic stories, the simulator build.
- [Run targus in GitHub Actions](guide/ci-github-actions.md), or [in CircleCI](guide/ci-circleci.md).
- [Review changes](guide/review.md): the review UI, and how baselines and approvals work.
- [Troubleshooting](guide/troubleshooting.md): every error message and its fix.

## Reference

- [CLI](reference/cli.md): `targus capture`, `compare` and `run`, environment, exit codes.
- [Story parameters](reference/story-parameters.md): `parameters.targus.skip` and `delay`.
- [API](../apps/api/README.md): the service's routes and configuration.

## Working on targus

For contributors: [AGENTS.md](../AGENTS.md) (where code goes, the rules),
[engineering standards](engineering-standards.md), the [design plan](plan.md), the
[web plan](web-plan.md) and the [architecture decisions](adr/README.md).
