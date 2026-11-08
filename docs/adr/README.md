# Architecture Decision Records

Each ADR is a short Markdown file named `NNNN-title.md` that records one significant decision with its context, the choice made, its consequences and the alternatives considered, following [0000-template.md](0000-template.md).

Statuses:

- **proposed**: written, not yet agreed.
- **accepted**: the decision holds as written.
- **accepted, amended by NNNN**: the decision holds, but a later ADR replaces named parts of
  it. The amended ADR keeps its original text and lists the replaced parts under "Amended by".
- **superseded by NNNN**: the decision no longer holds; read the later ADR instead.

When a later ADR overtakes an earlier one, update the earlier ADR's status and this table in
the same change.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-hosted-service-with-chromatic-like-review.md) | Hosted service with a Chromatic-like review UI | accepted |
| [0002](0002-cloudflare-free-tier-hosting.md) | Cloudflare free tier hosting: Workers, R2 and D1 | accepted, amended 2026-11-06 |
| [0003](0003-diff-on-ci-runner-not-server.md) | Pixel diffing on the CI runner, not the server | accepted, amended by [0014](0014-upload-record-grants-image-access.md) and [0016](0016-cli-measures-server-classifies.md) |
| [0004](0004-baseline-and-approval-rules.md) | Baseline and approval rules | accepted, amended by [0030](0030-an-unstable-capture-never-becomes-the-baseline.md) |
| [0005](0005-cached-native-build-with-js-rebundle.md) | Cached native build with a per-run JS rebundle | accepted, amended 2026-11-06 |
| [0006](0006-ios-only-full-screen-capture-for-v1.md) | iOS only, full-screen capture for v1 | accepted, amended 2026-11-06 |
| [0007](0007-org-scoped-tenancy.md) | Org-scoped tenancy from day one | accepted, amended by [0011](0011-github-login-sessions-and-org-authorization.md), [0012](0012-personal-accounts-as-single-member-orgs.md) and [0014](0014-upload-record-grants-image-access.md) |
| [0008](0008-storybook-websocket-channel-for-story-selection.md) | Storybook websocket channel for story selection | accepted, amended by [0022](0022-story-parameters-reported-by-the-decorator.md) |
| [0009](0009-every-standard-has-a-guard.md) | Every standard has a guard | accepted, amended 2026-11-06 |
| [0010](0010-package-builds-and-development-condition.md) | Package builds and the development condition | accepted, amended by [0025](0025-browser-entry-for-core.md) |
| [0011](0011-github-login-sessions-and-org-authorization.md) | GitHub login with cookie sessions and org-membership authorization | accepted, amended by [0015](0015-same-origin-session-writes-and-hashed-session-ids.md), PR #10 and PR #24 |
| [0012](0012-personal-accounts-as-single-member-orgs.md) | Personal accounts as single-member orgs | accepted, amended by [0024](0024-personal-account-owner-by-github-account-id.md) |
| [0013](0013-guarded-single-batch-build-writes.md) | Guarded single-batch writes for build results and reviews | accepted, amended by [0026](0026-review-approvals-and-check-runs-follow-the-review-version.md) and [0031](0031-replayable-results-submission.md) |
| [0014](0014-upload-record-grants-image-access.md) | An upload record, not a hash, grants a project access to an image | accepted, amended by PR #10 and PR #24 |
| [0015](0015-same-origin-session-writes-and-hashed-session-ids.md) | Same-origin checks on session writes, and hashed session ids | accepted |
| [0016](0016-cli-measures-server-classifies.md) | The CLI measures the diff, the server classifies the story | accepted, amended by [0028](0028-server-owns-the-diff-threshold.md) and [0032](0032-results-name-the-baseline-they-were-diffed-against.md) |
| [0017](0017-relative-imports-name-the-typescript-file.md) | Relative imports name the TypeScript file | accepted |
| [0018](0018-squash-merges-only.md) | Squash merges only, so every commit on main is a Conventional Commit | accepted |
| [0019](0019-web-features-meet-through-their-index.md) | Web features meet only through their index.ts | accepted |
| [0020](0020-one-structured-log-line-per-request.md) | One structured log line per request, with a request id and no secrets | accepted |
| [0021](0021-stop-the-capture-when-the-app-dies.md) | Stop the capture as soon as the app dies | accepted |
| [0022](0022-story-parameters-reported-by-the-decorator.md) | The decorator reports `parameters.targus` over the channel | accepted, amended 2026-11-06 and 2026-11-07 |
| [0023](0023-api-built-from-plain-dependencies.md) | The API is built from plain dependencies behind a thin Worker entry | accepted |
| [0024](0024-personal-account-owner-by-github-account-id.md) | The owner of a personal account is recognised by GitHub account id | accepted |
| [0025](0025-browser-entry-for-core.md) | A browser entry for core, so the web dev server loads no Node-only code | accepted |
| [0026](0026-review-approvals-and-check-runs-follow-the-review-version.md) | Approvals commit with the review, and check runs follow the review version | accepted |
| [0027](0027-idempotency-key-for-opening-a-build.md) | An idempotency key makes opening a build safe to retry | accepted |
| [0028](0028-server-owns-the-diff-threshold.md) | The server owns the diff threshold | accepted |
| [0029](0029-user-docs-in-the-repo-with-generated-cli-help.md) | User documentation lives in the repo, and the CLI help in it is generated | accepted |
| [0030](0030-an-unstable-capture-never-becomes-the-baseline.md) | An unstable capture never becomes the baseline | accepted |
| [0031](0031-replayable-results-submission.md) | A digest of the request makes submitting results safe to replay | accepted, amended 2026-11-07 |
| [0032](0032-results-name-the-baseline-they-were-diffed-against.md) | Results name the baseline they were diffed against | accepted |
| [0033](0033-the-cli-silences-system-notices-before-capture.md) | The CLI silences system notices before capture | accepted |
| [0034](0034-the-cli-pins-the-simulator-appearance.md) | The CLI pins the simulator appearance | accepted |
