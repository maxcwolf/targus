---
'@targus/react-native': minor
---

Breaking: `resolveTargusParameters`, `defaultTargusParameters` and `ResolvedTargusParameters` are
removed. Nothing in targus used them, and they disagreed with the rules the CLI applies (ADR
0022): they defaulted `delay` to 300 with no upper bound and quietly replaced an invalid value,
where the CLI uses `--settle` when `delay` is absent, accepts 0 to 10 000 ms, and makes a story
with an invalid value an error. Set `parameters.targus` and let the decorator report it.
`TargusParameters` is unchanged in meaning and is now checked against core's `StoryParameters`
schema (its fields accept an explicit `undefined`, as the schema does).
