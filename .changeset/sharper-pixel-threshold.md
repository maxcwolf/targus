---
'@targus/core': minor
'@targus/cli': minor
---

`diffImages` compares pixels with a colour threshold of 0.063, Chromatic's default, in place of
pixelmatch's 0.1. A restyle such as a button going one shade darker now counts as changed
pixels; before, only the edges around it did. Anti-aliasing is still tolerated. A story whose
capture already differed from its baseline can report a higher changed-pixel ratio than it did,
so a few that sat under the 0.1% failure threshold may now show as changed.
