---
'@targus/cli': patch
'@targus/react-native': patch
---

A story that throws an error with an empty message, such as `new Error()`, no longer gets the whole
results submission refused with a 400. `withTargus` reports `Error thrown with no message` (with the
error's name) instead of an empty message, and `targus run` replaces any empty or whitespace-only
story error, from the app, the channel or an older capture, with `the story threw an error with no
message`.
