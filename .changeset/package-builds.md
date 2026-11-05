---
'@targus/core': patch
'@targus/cli': patch
'@targus/react-native': patch
---

Ship built ESM, type declarations and source maps from `dist/` so the packages import at runtime
outside the monorepo. `@targus/cli` now depends on `@targus/core`; `targus capture` still exits 2.
