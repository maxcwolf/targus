# 0029. User documentation lives in the repo, and the CLI help in it is generated

## Status

accepted, amended 2026-11-07

## Date

2026-11-06

## Context

What a developer adopting targus needed was spread over the root README, `packages/cli/README.md`,
`apps/api/README.md`, `docs/plan.md` section 8 and the proof-of-concept repository. Nothing told
them where to start, and nothing kept the flag tables in the CLI README in step with the flags.
A documentation site is planned. It should render the same files rather than keep its own copy,
so the Markdown has to read well on GitHub as well as on the site.

## Decision

We will keep user documentation as plain GitHub-flavoured Markdown in `docs/`:

- `docs/guide/`: getting started, setup, CI, review and troubleshooting;
- `docs/reference/`: the CLI and story parameters;
- `docs/prompts/`: copy-paste prompts that have a coding agent do the setup;
- `docs/README.md`: the index.

The design documents (`plan.md`, `engineering-standards.md`, `adr/`) stay where they are. Pages
use only what GitHub renders: GFM tables, alerts, fenced code blocks, `<details>` and Mermaid.
They do not use MDX.

The `targus <command> --help` blocks in `docs/reference/cli.md` are generated from the built CLI
by `yarn docs:cli`, between `<!-- cli-help: <command> -->` markers. `scripts/docs-cli-help.test.mjs`
fails `yarn check` when they differ from the CLI's output (ADR 0009). The package README
(`packages/cli/README.md`) shrinks to an introduction that links to the reference.

## Consequences

### Positive

- One place to start (`docs/README.md`), linked from the root README.
- The flag reference cannot drift from the flags.
- The planned site can load `docs/` as it is.

### Negative

- Changing a flag's description means running `yarn workspace @targus/cli build && yarn docs:cli`
  before `yarn check` passes.
- Prose around the generated blocks (the environment, exit codes, the troubleshooting messages)
  is still written by hand and can drift.
- The npm README links into the repository, which readers without access to it cannot follow
  until the docs site is published. (Amended 2026-11-07: the repository is public, so anyone can
  follow these links; the cost is gone.)

## Alternatives considered

- **Keep the reference in the package README.** npm shows it, but it grew to 300 lines mixing
  reference, CI recipes and contributor notes, and nothing checked it.
- **Write the docs in the site's own format (MDX).** Richer components, but GitHub would show raw
  JSX, and the repo is where contributors and agents read them.
- **Generate the whole reference from the commander definitions.** It would cover flags only; the
  help output already holds every flag, its default and its description.
