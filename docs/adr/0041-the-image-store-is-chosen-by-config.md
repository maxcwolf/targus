# 0041. The image store is chosen by config

## Status

accepted

## Date

2026-11-09

## Context

Images live behind the `ImageStore` port (put, get, missing). Until now the only adapter was
`R2ImageStore` over the Worker's `IMAGES` binding, so running targus on another host meant
writing a second adapter first (docs/hosting-portability.md, step 2). A host that keeps its
objects in AWS S3, MinIO or another S3-compatible service needs an adapter that speaks the S3
HTTP API with SigV4 signatures.

`knip` rejects a file that no entry reaches, so a new adapter has to be wired into a real entry
when it lands. Today the Worker is the only entry; the Node entry of step 4 does not exist yet.
R2 itself speaks the S3 API, so the same adapter also runs on Cloudflare.

## Decision

We will add `S3ImageStore` in `apps/api/src/storage/s3-image-store.ts`. It signs requests with
`aws4fetch` (a small SigV4 signer that runs on Workers and Node; a dependency of `apps/api` only),
takes the `fetch` it sends with as a constructor argument, supports a custom endpoint with either
path-style (`endpoint/bucket/key`) or virtual-hosted (`bucket.endpoint/key`) URLs, and keeps the
R2 store's behaviour: keys `images/<hash>.png`, an idempotent `put` that first asks with HEAD,
`image/png` with an immutable cache-control, `missing()` answered by the `images` table, a 404 read
as "not there" and any other failure thrown.

The host's entry chooses the store from config. `config.ts` validates `S3_ENDPOINT`, `S3_REGION`,
`S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` all-or-none (like the GitHub App
secrets) plus an optional `S3_FORCE_PATH_STYLE`, and exposes them as `ApiConfig.s3`. When it is
set, the Worker's `createCloudflareStorage` builds `S3ImageStore` with the global `fetch`;
otherwise it builds `R2ImageStore` over the binding as before. A future Node entry builds the S3
store from the same config.

## Consequences

### Positive

- A host without R2 can keep images in any S3-compatible bucket by setting five variables; no
  code changes.
- The Worker can already run against an S3 bucket, so the adapter is reachable and tested now,
  before the Node entry exists.
- Both adapters use the same key layout, so a bucket can be copied to the other store as is.

### Negative

- The Worker keeps its `IMAGES` binding even when S3 is configured; it is simply unused.
- The image metadata (the `images` table) stays in the database, so switching stores without
  copying the objects leaves hashes recorded whose bytes are in the other store.
- The adapter is tested against an in-memory S3 behind `fetch`. Differences of real servers
  (error codes, a 403 instead of a 404 for a missing key without list permission) are not covered
  until the contract suite runs against MinIO or S3.

## Alternatives considered

- **The AWS SDK (`@aws-sdk/client-s3`).** Complete, but large and Node-oriented; on Workers it
  needs polyfills. A signer plus `fetch` is all three operations need.
- **A store chosen by the entry, not by config.** The Worker would always use R2 and only a Node
  entry would use S3. That leaves the adapter unreachable until the Node entry exists and takes
  away the option of R2 through its S3 API or an external bucket from a Worker.
- **Defaulting the endpoint from the region (AWS only).** Saves one variable on AWS but makes
  MinIO and R2 the special case; an explicit endpoint is the same for every service.
