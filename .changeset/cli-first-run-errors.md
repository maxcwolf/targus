---
'@targus/cli': patch
---

`targus run` checks the API URL before it touches git, the simulator or the API: `--api-url` and
`TARGUS_API_URL` must be http or https with no credentials, query or fragment, trailing slashes are
dropped and a trailing `/api` is rejected, and a bad value fails at once with a message naming the
flag or variable, the value (credentials masked) and an example. An empty `TARGUS_TOKEN` exits 3
like a missing one. A simulator list from `xcrun simctl list devices --json` that cannot be read,
and a `--udid` it does not list, are reported in plain words with what to try instead of a parser
error. `createProgram`'s `loadConfig` option now receives the `--api-url` override.
