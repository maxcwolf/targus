# 0009. Every standard has a guard

## Status

accepted

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
complete the set. All guards go live in M1, before any feature code.

## Consequences

### Positive

- Drift is caught mechanically rather than by memory or goodwill.
- Agents and humans face the same gates with no special path.

### Negative

- Upfront setup cost in M1 before any feature work.
- Known gaps rely on humans: ADR discipline (a PR template checkbox, no automation), naming
  quality, and whether a test asserts behaviour rather than implementation.

## Alternatives considered

- **Standards documented in prose and enforced by review.** Rejected because prose-only rules
  are violated under time pressure. Review is kept only for the known gaps.
