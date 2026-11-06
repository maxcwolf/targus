---
'@targus/cli': patch
---

`targus run` and `targus capture` no longer hang on a stuck simulator, git or network call:
every `xcrun simctl`, `git` and `plutil` call has a timeout (minutes for boot and install,
seconds for the rest) and is killed when it expires, and every API request is aborted after 60s.
Each failure names the command or request that timed out. Image uploads, image downloads and the
results submission are retried up to four times with backoff on network errors, timeouts, 429
and 5xx (never on other 4xx), printing a warning per retry, so one flaky upload no longer fails a
build. When the app never connects, the error now says what to check.
