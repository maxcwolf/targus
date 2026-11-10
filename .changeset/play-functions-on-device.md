---
'@targus/cli': minor
'@targus/react-native': minor
---

Play functions on a device. `@targus/react-native` exports `onDevice(context)`, whose `press` and
`changeText` find an element of the story by its accessibility label or `testID` and call its
handler, for the on-device Storybook's `reactNative: { playFn: true }`. `targus capture` and
`targus run` now wait for a story's play function before the screenshot, and record one that
throws as an error of that story (ADR 0047).
