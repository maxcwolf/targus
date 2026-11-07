# 0032. Results name the baseline they were diffed against

## Status

accepted

## Date

2026-11-07

## Context

`POST /api/builds` returns each story's baseline: the accepted image of the story in the
baseline build (ADR 0004, rule 5). The CLI downloads the baselines that differ, diffs locally
(ADR 0003) and submits a diff ratio and diff image per story. At submit, the server works the
baselines out again from the same baseline build and classifies each story with
`compareSnapshot` and the CLI's ratio (ADR 0016).

The baseline build is stored on the build, but its accepted images are not: they follow its
reviews. A reviewer who denies a story on the baseline build while a run is open moves that
story's accepted image from the capture back to the image before it, and approving it again
moves it forward. The server then classifies the CLI's ratio against a baseline the CLI never
saw. If the CLI saw equal hashes and reported ratio 0, the server stores `unchanged` against the
other baseline, so the change that was just denied passes the check and, on the default branch,
becomes the next baseline. A ratio under the threshold is the same: the server trusts a
measurement of one image pair for another. A diff image stored with the snapshot can belong to
another baseline than the one the review UI shows next to it.

The window is the time between `POST /api/builds` and the submit: the downloads, the diffs and
the uploads, minutes for a large project. It is rare, but nothing detected it.

The invariant we want: a stored snapshot's state, diff ratio and diff image always refer to its
stored `baseline_hash`.

## Decision

We will pin the baseline in every result, and the server will drop a diff measured against any
other baseline than its own.

- `StoryResult` carries `baselineHash`: the baseline `POST /api/builds` returned for the story,
  which the CLI diffed against, or null when it returned none. It is required (nullable), and a
  result with no `baselineHash` must have `diffRatio` and `diffHash` null, since nothing was
  diffed. `targus run` sends the offered hash for every story, error results included.
- Core's `pinnedDiff(result, baselineHash)` decides what of the CLI's diff the server keeps.
  When the result's `baselineHash` equals the baseline the server compares with at submit, it
  keeps `diffRatio` and `diffHash`. When it differs, it drops both: the ratio becomes 0 when the
  capture is the server's baseline itself, and null otherwise; the diff image becomes null.
- The results service classifies with what `pinnedDiff` kept and stores the server's baseline as
  `baseline_hash`. So a capture that differs from the moved baseline is `changed` (pending,
  unless an approval for that exact hash pair exists), a capture equal to it is `unchanged`, and
  a story whose baseline disappeared is `new`. The server writes a `baseline_moved` warning with
  the build id and the number of such stories to the request's log line (ADR 0020).
- The baseline is still never taken from the request (ADR 0014): the pinned hash is only
  compared, never stored, so it needs no upload check.

The review UI already handles a `changed` snapshot with no diff image: it shows the baseline and
the capture without the diff overlay, and no ratio. The server cannot compute the diff itself
(ADR 0003), so that is what a reviewer gets for a story caught in the race.

`baselineHash` is required rather than optional. If it were optional and its absence meant
"trust the ratio", a CLI that omits it would keep the race open; if absence meant "moved",
every story with a baseline from such a CLI would lose its diff and need review. The CLI and the
API ship together from this repository, as for the threshold (ADR 0028), so a CLI released
before this change gets a `bad_request` naming `baselineHash` and must be upgraded.

## Consequences

### Positive

- A denial on the baseline build during a run can no longer let the denied change pass as
  `unchanged`, and a stored ratio or diff image never belongs to another baseline.
- A rare race costs a review, not a stuck build: the submit succeeds, the build gets its check
  run, and the CLI needs no retry path.
- The rule is one pure function in core, tested beside `compareSnapshot`; the service change is a
  few lines.
- No schema change and no stored record of the offered baselines.

### Negative

- A story caught in the race is reviewed without a diff overlay or ratio, and a change under the
  threshold against the moved baseline still asks for review. Both are deliberate: the server
  cannot measure the pair, so it errs towards review.
- A diff image the CLI uploaded for a dropped diff is stored but referenced by no snapshot.
- `unstable` reaches the server only as the CLI's state. A story the CLI captured unstably but
  classified `new` or `unchanged` against the offered baseline is not recognised as unstable,
  so against a moved baseline it is `changed` and needs review.
- A CLI released before this change is refused until it is upgraded.
- The CLI's printed counts can differ from the stored build for one more reason; the summary
  line it prints is the server's.

## Alternatives considered

- **Refuse the submit with 409 when a baseline moved**, so the CLI judges again against fresh
  baselines. The build stays `in_progress` with no check run until a rerun, and a reviewer
  working on the baseline build can keep moving it. Fixing that needs a re-judge loop in the CLI
  (reopen under the same idempotency key, download, diff, upload, resubmit) for a rare race,
  next to the replayed-submit handling the results already need.
- **Keep the CLI's pinned baseline as the snapshot's baseline** when the server can verify that
  it offered that hash for this build, by recording the offered baselines when the build opens.
  It needs a new table or column and a migration, and it stores exactly the wrong answer for the
  main case: the denied image would be the baseline, and a capture of it would be `unchanged`,
  so the change a reviewer had just denied would pass.
- **Snapshot the baselines when the build opens and always classify against them.** The same
  storage cost as the previous option, and the same problem: a denial during the run would not
  count for this build.
- **The server diffs the new pair itself.** Ruled out by the Worker CPU budget (ADR 0003).
