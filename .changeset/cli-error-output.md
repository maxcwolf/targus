---
'@targus/cli': minor
---

`targus` reports every failure as a few plain lines on stderr with exit code 1 (2 and 3 as
before) instead of a Node stack trace: an unreachable API names the URL and the reason, and a
missing file, a missing command, a port in use or data that fails validation each get their own
wording. `TARGUS_DEBUG=1` adds the stack traces back. The environment is now read only when
`targus run` runs, so `--help` and `--version` work with nothing set. `createProgram` takes a
`loadConfig` function instead of a `config` object; the exit-code helpers and `describeError`
are exported from the package index.
