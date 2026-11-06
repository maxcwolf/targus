---
'@targus/cli': patch
---

Simulator screenshots are captured to a temporary file and read back instead of through
`simctl io screenshot -`, whose stdout mode writes a file named `-` on Xcode 27.2. The temp file
is always removed. A capture that leaves an empty or missing file now fails with
`simctl exited 0 but wrote no screenshot (0 bytes)` (or `... no screenshot file`) instead of
`screenshot is not a PNG`.
