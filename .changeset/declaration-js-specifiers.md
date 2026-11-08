---
'@targus/core': patch
'@targus/cli': patch
'@targus/react-native': patch
---

Published type declarations now import their sibling files as `./x.js`, not `./x.ts`, so tools
that follow `.d.ts` imports (dependency-cruiser, for example) resolve them.
