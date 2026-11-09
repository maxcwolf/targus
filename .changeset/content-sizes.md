---
'@targus/core': minor
'@targus/cli': minor
'@targus/react-native': minor
---

Capture a story on a device at other system text sizes. `parameters.targus.contentSizes` lists
sizes by short name (`xs` to `xxxl`, then `ax1` to `ax5` for the accessibility sizes);
`targus capture` and `targus run` set each on the simulator with `simctl ui content_size`,
screenshot the story as the variant `<story id>@<size>`, and put the size back. Every run now
pins the default size, `l`. `DeviceDriver` gains `setContentSize`, and `TargusParameters` gains
`contentSizes` (ADR 0042).
