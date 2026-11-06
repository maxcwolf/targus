# 0016. The CLI measures the diff, the server classifies the story

## Status

accepted

## Date

2026-11-06

## Context

ADR 0003 put pixel diffing on the CI runner. Its decision text also had the CLI "submit
per-story statuses and diff stats" to `POST /api/builds/:id/results`, which reads as if the
server stores whatever state the CLI computed. That is not what was built in the API, and no ADR
records what was built.

Two things make the CLI's classification the wrong one to store:

- Classification depends on the project's approvals (ADR 0004, rule 3): a `changed` story whose
  hash pair was approved before is auto-approved. Approvals live on the server, and the CLI
  never sees them.
- The CLI is a client holding a project token. If its state were stored as sent, a buggy or
  outdated CLI would decide what needs review, and an old CLI release would keep the old rules.

The server cannot diff images itself: decoding two retina PNGs exceeds the Worker's CPU budget
(ADRs 0002, 0003). But classifying a story from hashes and a diff ratio is a cheap, pure
function: `compareSnapshot` in `packages/core`.

## Decision

We will split the work. The CLI measures what only the runner can measure, and the server
decides.

- **The CLI measures.** For each story the CLI sends `imageHash`, `width`, `height`,
  `diffRatio` and `diffHash`. It computes the ratio and diff image locally with `diffImages`,
  only when the hashes differ (ADR 0003). It also sends whether the capture was stable
  (`state: 'unstable'`), whether it is `blank`, and the render `error` text. The CLI also
  classifies with `compareSnapshot` and its own `--threshold`, but only for its summary and to
  decide which diff images to upload.
- **The server classifies.** `POST /api/builds/:id/results`
  (`apps/api/src/services/results.service.ts`) derives each story's baseline hash from the
  baseline build, never from the request (ADR 0014). It runs `compareSnapshot` with the
  deployment's `DIFF_THRESHOLD`, the CLI's diff ratio and the project's approvals, and stores
  the resulting `state` and `review`. A `state` the CLI sent is overwritten. The CLI's state is
  read only for `unstable`; `error` is read from the `error` field.
- **The server adds `removed`.** Baseline stories the build did not report are stored as
  `removed` by the server; the CLI never sends them.

## Consequences

### Positive

- One rule set decides every stored state, in one place, with the approvals it needs.
- A CLI release cannot change what needs review; a server deploy can, for every client at once.
- The Worker still does no image work, so ADR 0003's CPU argument stands.

### Negative

- The diff ratio is still trusted from the client. A CLI that sends a ratio of 0 for a changed
  image gets it stored as `unchanged`. Acceptable for an internal tool, as in ADR 0003.
- There are two thresholds, the server's `DIFF_THRESHOLD` and the CLI's `--threshold`, and
  nothing keeps them equal. If the CLI's is higher, a story the server marks `changed` can
  arrive without a diff image, and the review UI has no diff overlay for it.
- The CLI's printed summary can disagree with the stored build. Approvals and a different
  threshold are both reasons. The review UI shows the stored build.
- Tuning the threshold per project or per story (plan.md section 7) needs a server-side
  setting, not only a CLI flag.

## Alternatives considered

- **Store the CLI's state as sent** (a literal reading of ADR 0003). Simplest server, but the
  CLI cannot apply approvals, and every client version would carry its own rules.
- **The server diffs too.** Ruled out by the Worker CPU budget (ADR 0003).
- **The server sends its threshold to the CLI** in the `POST /api/builds` response, so the CLI's
  summary and diff uploads match. A good follow-up that would remove the second threshold; not
  built.
