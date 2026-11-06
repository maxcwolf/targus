# 0014. An upload record, not a hash, grants a project access to an image

## Status

accepted

## Date

2026-11-06

## Context

Images are content-addressed: the `images` table and the R2 bucket hold one object per SHA-256,
shared by every project of every org, so identical screenshots are stored once (ADR 0002). ADR
0007 scopes every table by org through `projects`, but `images` has no project column and
cannot have one, because one row serves many projects.

Until this decision a project token could use any hash the server held. `GET /api/images/:hash`
answered the bytes to any token, `POST /api/builds` reported a hash as present when any project
had uploaded it, and `POST /api/builds/:id/results` accepted any hash as a story's image.
A token that learned a hash from another org (from a log, a URL, or by guessing a common
screenshot) could read that org's image, or attach it to its own build and read it back as its
own. Knowing a hash was enough, and a hash is not a secret.

## Decision

We will treat an upload as the only thing that gives a project the right to an image. The
`project_images` table records which project sent which hash, and a project token may read a
hash, or name it in its results, only when that project has a row for it.

- `PUT /api/images/:hash` always records the upload for the calling project, whether or not the
  bytes were already stored.
- `POST /api/builds` answers which hashes this project has not uploaded, not which hashes the
  store lacks. A project sends the bytes once even when another project already holds them.
- `GET /api/images/:hash` with a project token answers `not_found` for a hash the project did
  not upload, exactly as for a hash that does not exist.
- `POST /api/builds/:id/results` answers `bad_request` when a result names an `imageHash` or
  `diffHash` the project did not upload. The baseline hash is never taken from the request: the
  server derives it from the baseline build.

A reviewer's access is unchanged and stays with ADR 0007 and ADR 0011: a session may read an
image when a build that references it belongs to a project in one of the reviewer's orgs.

The rule lives in `apps/api/src/services/image.service.ts`, `build.service.ts` and
`results.service.ts`, over `ImageRepository.recordUpload` and `notUploadedBy`.

## Consequences

### Positive

- The tenancy boundary of ADR 0007 now covers the one table that could not carry an org column.
- Storage stays deduplicated: the bytes are still stored once per hash across all projects.
- A token learns nothing about other tenants from a read. Missing and forbidden look the same.

### Negative

- A project uploads every image it uses at least once, even when the store already has the
  bytes. The first build of a new project sends everything.
- The upload response's `stored: false` tells an uploader that the bytes already existed. The
  uploader must hold the bytes to ask, so this reveals only that someone else has an identical
  image.
- `project_images` is a second place that refers to an image. Any future cleanup that deletes
  images must delete these rows with them, and must not delete an image a project still claims.
- A build opened before this rule was deployed and submitted after it can be refused, and is
  fixed by running it again.

## Alternatives considered

- **Store images per project** (key the object by project and hash). The boundary becomes
  structural, but the same screenshot is stored once per project, which spends the R2 free tier
  of ADR 0002 faster and makes moving a repository between projects a copy.
- **Derive access from snapshots** (a project may use a hash that one of its builds references).
  This is the reviewer rule. For a token it is circular: naming a foreign hash in a result is
  what creates the reference.
- **Treat the hash as a capability.** Simple, and common for content-addressed stores, but a
  SHA-256 of a screenshot is not secret: it appears in URLs and logs, and anyone holding a
  similar build can compute it.
