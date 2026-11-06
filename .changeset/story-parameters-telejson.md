---
'@targus/core': patch
'@targus/cli': patch
'@targus/react-native': patch
---

Fix every story failing with `invalid parameters.targus: expected object, received string` on a
real app. Storybook's channel serialises with telejson, which sends `undefined` as the string
`_undefined_`, so a story that set no `parameters.targus` was rejected. `withTargus` now leaves
`targus` out of the `targus/storyParameters` payload when the story sets none, core's
`StoryParametersPayload` accepts that missing key, and the CLI decodes telejson's `_undefined_`
before validating, so an app built with the previous decorator works too.
