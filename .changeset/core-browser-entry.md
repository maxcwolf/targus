---
'@targus/core': minor
---

`@targus/core/browser`: a second entry with everything in `@targus/core` except the PNG image
code (`diffImages`, `isBlankPng`), whose pngjs dependency needs Node's `util`, `zlib` and
`stream`. Browser code imports it so a dev server that runs modules unbundled never loads pngjs.
The root entry is unchanged.
