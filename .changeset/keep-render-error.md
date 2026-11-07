---
'@targus/cli': patch
'@targus/react-native': patch
---

Fix a story that throws while rendering passing as a blank snapshot. `withTargus` sent the story's
`targus/storyParameters` right after its `targus/storyError`, and when both reached the CLI before
it read them, the parameters replaced the error. The CLI now keeps a story's render error over any
later parameters report, so an app built with the previous decorator fails the story too, and it
forgets the error when a new selection renders the story again. `withTargus` now reports
parameters from inside its error boundary, so a story that throws sends only the error.
