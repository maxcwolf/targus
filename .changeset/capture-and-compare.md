---
'@targus/cli': minor
'@targus/react-native': minor
---

`targus capture` drives on-device Storybook in an iOS simulator over the websocket channel and
writes one PNG per story plus `manifest.json`; `targus compare` diffs two captures into
`report.json`, `report.html` and diff PNGs. `withTargus` now wraps each story in an error
boundary that reports render errors as `targus/storyError`.
