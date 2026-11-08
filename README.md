# targus

Visual review for the native, on-device Storybook of a React Native app: CI renders every story
in an iOS simulator, compares it with the accepted baseline, and publishes a GitHub check that
stays pending until each change is approved in a Chromatic-like review UI.

## Use targus

- [What targus is](docs/guide/overview.md) and how it works.
- [Quickstart](docs/guide/quickstart.md): your first capture in about 15 minutes.
- [Set up with an AI agent](docs/prompts/README.md): copy-paste prompts for Claude Code or Codex.
- [Run it in GitHub Actions](docs/guide/ci-github-actions.md), [review changes](docs/guide/review.md),
  and [troubleshooting](docs/guide/troubleshooting.md).
- Everything else: [the documentation](docs/README.md).

## Work on targus

The design is in [docs/plan.md](docs/plan.md); the rules and their guards are in
[docs/engineering-standards.md](docs/engineering-standards.md); decisions are in
[docs/adr/](docs/adr/). Contributors (and agents) start with [AGENTS.md](AGENTS.md).

### Develop

Requires Node 22 (`.nvmrc`) and Corepack (Yarn 4 is pinned in `package.json`).

```sh
corepack enable
yarn install                       # also installs the lefthook git hooks
yarn check                         # every guard: types, lint, format, architecture, dead code, tests
yarn test                          # tests with coverage only
yarn playwright install chromium   # once
yarn e2e                           # builds the web app, serves it from a local Worker, runs Playwright
```

### Run it locally

```sh
yarn dev:local    # then open http://127.0.0.1:8900 and click "Sign in with GitHub"
```

No GitHub account, App or secret is needed. The command starts a stub GitHub
(`e2e/support/github-stub.ts`) and a local Worker pointed at it, applies the migrations to a fresh
local D1 (`e2e/.wrangler/local-8900/`, wiped on every start; never a remote database), creates the
project `targus-local/demo` and publishes two builds with `targus run --from-capture`: an
accepted baseline and a PR build with one changed story to approve or deny. The builds come from
a throwaway git repository the command creates next to its state, not from this checkout, so a
shallow clone or a copy without `.git` works too. Sign-in makes you
`octocat`, a member of every org. The command prints how to sign in as `outsider` instead (not a
member, so the review UI refuses to let you review), the project token for your own
`targus run`, and the admin token. Ctrl-C stops everything.

Flags: `--port` (default 8900) and `--github-stub-port` (8901), which differ from the e2e
suite's 8787 and 8788 so both can run at once, and `--public-url`. Open the UI at exactly the
printed origin: the API refuses review writes from any other origin (ADR 0015). To work on the UI
with hot reload, serve it from the Vite dev server instead: pass the dev server's origin as
`--public-url`, and point the dev server's `/api` proxy at the Worker with `TARGUS_API_URL`
(default `http://localhost:8787`, the port of `yarn workspace @targus/api dev`):

```sh
yarn dev:local --public-url http://localhost:5173
TARGUS_API_URL=http://127.0.0.1:8900 yarn workspace @targus/web dev   # in a second terminal
```

Then open http://localhost:5173.

Scaffolding: `yarn new:route <name>` and `yarn new:adapter <port> <name>` create files in the
right layer with a test beside them.

### Documentation

User documentation lives in [docs/](docs/README.md) as plain Markdown: guides in `docs/guide/`,
reference in `docs/reference/`, and the AI setup prompts in `docs/prompts/`. The `--help` blocks
in [docs/reference/cli.md](docs/reference/cli.md) are generated: after changing a CLI flag or its
description, run `yarn workspace @targus/cli build && yarn docs:cli`. `yarn check` fails while
they are out of date.

### Notes

- `.github/CODEOWNERS` names `@maxcwolf` while the repo lives under that account. Point it at an
  org team when the repo moves, before enabling "require review from code owners".
- `spike/` is the throwaway capture spike of 2026-11-04
  ([docs/capture-spike.md](docs/capture-spike.md)). It is not a workspace and no guard checks it.

## License

[MIT](LICENSE), copyright Max Wolf.
