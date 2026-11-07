# 0028. The server owns the diff threshold

## Status

accepted

## Date

2026-11-06

## Context

ADR 0016 split the work: the CLI measures each story's diff ratio and uploads diff images, and
the server classifies the story with `compareSnapshot`. Both sides compared the ratio against a
threshold, and each had its own: the server's `DIFF_THRESHOLD` decided the stored state, and
`targus run --threshold` decided the CLI's summary and which diff images it uploaded. Nothing
kept them equal. With a CLI threshold above the server's, a story with a ratio between the two
was unchanged for the CLI, so it uploaded no diff image, and changed for the server, so the
review UI showed a changed story with no diff overlay. ADR 0016 listed this as a known risk and
named the fix as a follow-up.

The threshold has to live on one side. The server is the side that stores the state, applies
the approvals, and will carry a per-project setting (plan.md section 7); the CLI is a client
whose version and flags vary per CI job.

## Decision

We will make the server the owner of the diff threshold.

- `packages/core` exports `defaultThreshold` (0.001, 0.1% of pixels) next to
  `compareSnapshot`. The API's `DIFF_THRESHOLD` defaults to it. A per-project setting can
  replace the deployment value later without changing this contract.
- `POST /api/builds` returns `threshold`, the value the server classifies with.
- `targus run` diffs with that value, so it uploads a diff image for every story the server
  will store as changed. `run` no longer accepts `--threshold`; passing it is an error that says
  the server owns the threshold. `targus compare` keeps its `--threshold` flag because it runs
  offline, with no server.
- `POST /api/builds/:id/results` carries the `threshold` the CLI diffed with, and the server
  refuses results measured with any other one (`conflict`, 409) and stores nothing. This closes
  the remaining window: a server whose `DIFF_THRESHOLD` changed between opening the build and
  submitting it, or a client that ignored the response.

## Consequences

### Positive

- One threshold decides both the stored state and which diff images exist, so every story
  stored as changed has a diff image.
- Changing the threshold is a server setting that every client follows on its next build, which
  is where a per-project setting will go.
- The CLI's printed summary disagrees with the stored build only because of approvals, never
  because of the threshold.

### Negative

- `SubmitResultsRequest.threshold` and `CreateBuildResponse.threshold` are required, so a CLI
  released before this change gets a `bad_request` from the API and must be upgraded. The API
  and CLI are released together for an internal tool, so we accept the break.
- A CI job can no longer loosen the threshold for one run. That was the source of the mismatch;
  per-story tuning (plan.md section 7) is the planned way to loosen it.
- A build open while `DIFF_THRESHOLD` changes fails its submission and has to be rerun.

## Alternatives considered

- **The CLI sends its threshold with the build and the server uses it.** Keeps the flag, but
  lets every CI job decide what counts as changed, which ADR 0016 rejected for the state itself,
  and leaves no place for a per-project setting.
- **Keep both thresholds and document that they must be equal** (the state before this ADR).
  Nothing enforced it, and the failure (a changed story with no diff) was silent.
- **The server uploads missing diff images itself.** Ruled out by the Worker CPU budget
  (ADR 0003).
