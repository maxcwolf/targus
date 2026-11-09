---
'@targus/core': minor
'@targus/cli': minor
'@targus/react-native': minor
---

Capture a story on a device at another system text size. A mode in `parameters.targus.modes` may
set `contentSize` to one of the content size categories (`accessibility-extra-extra-extra-large`
for the largest); `targus capture` and `targus run` set it on the simulator with
`simctl ui content_size`, screenshot the story as the variant `<story id>@<mode>`, and put the
size back. Every run now pins the default size, `large`. `DeviceDriver` gains `setContentSize`,
and `TargusMode` gains `contentSize` (ADR 0042).
