# 0003. Pixel diffing on the CI runner, not the server

## Status

accepted

## Date

2026-11-04

## Context

Every build compares each captured story with its baseline image. Captures are full-screen 3x
retina PNGs (capture at device pixels is marked as an assumption in plan.md). Workers on the
free plan have a small per-request CPU budget, and decoding two such PNGs and running
pixelmatch would exceed it. The CI runner for the pilot app is a CircleCI macOS machine with idle cores
that already holds the current images.

## Decision

We will diff in the CLI on the CI runner. `targus run` hashes every screenshot, sends the
snapshot list to `POST /api/builds`, and receives the baseline hashes plus the hashes the
server is missing. It downloads only the baselines whose hash differs (usually a handful),
diffs them locally with pixelmatch through `diffImages` in `packages/core`, uploads missing
images and diff images, and submits per-story statuses and diff stats to
`POST /api/builds/:id/results`. The server stays a thin metadata and storage layer.

The default threshold is anti-aliasing tolerant pixelmatch failing above 0.1% changed pixels,
tunable per project and per story. This default is listed as an assumption in plan.md.

## Consequences

### Positive

- The Worker stays well inside its CPU budget and the free tier.
- Diffing uses compute the CI job already pays for, and only differing baselines are fetched.
- `diffImages` is pure and testable with fixture images.

### Negative

- Results are trusted from an authenticated CLI. This is acceptable for an internal tool.
- A build cannot be re-diffed with a different threshold without re-running the capture.
- Diff logic ships in the CLI, so a fix reaches CI only when the consumer updates the package.

## Alternatives considered

- **Diff on the server in the Worker.** Rejected because decoding two retina PNGs and running
  pixelmatch exceeds the free plan's per-request CPU budget.
