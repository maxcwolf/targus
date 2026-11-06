# 0009. Every standard has a guard

## Status

accepted, amended 2026-11-06

## Amended by

The decision still holds: every rule names its guard, and `yarn check` is the one command.
On 2026-11-06 several statements in the text below did not match the repository. They were
never built or were built differently, not changed by a later ADR.
[docs/engineering-standards.md](../engineering-standards.md) sections 4 and 6 describe what
exists and what is planned.

- **Item 1, the hooks.** Pre-commit does not run `yarn check`. `lefthook.yml` runs Prettier and
  ESLint on the staged files before a commit, commitlint on the message, and `yarn check`
  before a push. CI runs `yarn check`, `gitleaks` and the PR title lint
  (`.github/workflows/check.yml`) and `yarn e2e` (`.github/workflows/e2e-review.yml`).
- **Item 2, branch protection.** Not built. `main` has no branch protection and no rulesets
  (the GitHub API answers "Branch not protected"), so no job, approval or code-owner review is
  required to merge, and there is no changeset check in CI. Linear history holds because the
  repository allows squash merges only ([ADR 0018](0018-squash-merges-only.md)).
- **Item 3, CODEOWNERS.** `.github/CODEOWNERS` also covers `lefthook.yml`, `knip.json` and
  `.github/`. Without branch protection it requests the owner's review but does not require
  it, so a guard change is visible in review, not blocked.
- **Item 5, "an agent that ignores it cannot merge".** Not true while CI does not block a merge
  (item 2).
- **The nightly drift jobs.** Not built: there is no nightly workflow and no mutation testing,
  and knip runs only inside `yarn check`. `renovate.json` is committed with a weekly schedule;
  whether the Renovate app is installed is not known, and it has opened no pull request. The
  PR template checklist exists (`.github/PULL_REQUEST_TEMPLATE.md`).

## Date

2026-11-04

## Context

targus will be written by engineers and by coding agents. A standard that lives only in prose
will be violated by the next engineer or agent under time pressure. The answer chosen in
engineering-standards.md section 4 is to make the standard the path of least resistance and
make CI the thing that says no.

## Decision

Every rule in engineering-standards.md names the tool or CI check that enforces it. Prose
explains why; tooling enforces what. The enforcement rests on:

1. **One command.** `yarn check` runs typecheck, lint, Prettier check, dependency-cruiser,
   knip, and unit and integration tests with coverage. Pre-commit runs it on staged packages
   and CI runs exactly it plus the e2e suites, so local and CI never disagree.
2. **Branch protection.** `main` requires `check`, `e2e-review`, PR title lint, changeset
   check, one human approval and linear history. Admins are not exempt.
3. **CODEOWNERS on guard files.** `.dependency-cruiser.cjs`, `tsconfig.base.json`,
   `eslint.config.js`, `vitest.config.ts` thresholds, `docs/adr/` and `AGENTS.md` require a
   maintainer review, so loosening a guard is a visible, reviewed act.
4. **Scaffolding over instructions.** `yarn new:adapter <port> <name>` and
   `yarn new:route <name>` generate files in the right layer with a test beside them.
5. **AGENTS.md** at the root, imported as `CLAUDE.md`, states in under 80 lines the layer map,
   the ports list and the core rules. CI gates still apply, so an agent that ignores it cannot
   merge.

A PR template review checklist and nightly drift jobs (mutation score on `core`, Renovate, knip)
complete the set. All guards go live with the walking skeleton, before any feature code.

## Consequences

### Positive

- Drift is caught mechanically rather than by memory or goodwill.
- Agents and humans face the same gates with no special path.

### Negative

- Upfront setup cost before any feature work.
- Known gaps rely on humans: ADR discipline (a PR template checkbox, no automation), naming
  quality, and whether a test asserts behaviour rather than implementation.

## Alternatives considered

- **Standards documented in prose and enforced by review.** Rejected because prose-only rules
  are violated under time pressure. Review is kept only for the known gaps.
