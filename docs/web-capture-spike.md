# Web capture spike

Step W0 of [web-plan.md](web-plan.md), run on 2026-11-08. Result: **go**. The decision it
supports is [ADR 0037](adr/0037-web-capture-with-playwright-on-the-runner.md).

## Setup

A throwaway Node script (not in the repo) served a built `storybook-static` over `node:http`
and drove headless Chromium with `playwright-core` 1.65.0 inside the official
`mcr.microsoft.com/playwright:v1.65.0-noble` image. For each entry of type `story` in
`index.json` it:

1. opened `iframe.html?id=<id>&viewMode=story` in one reused page (viewport 1200x900, pixel
   ratio 1, reduced motion, locale `en-US`, timezone `UTC`);
2. waited on the preview's channel (`window.__STORYBOOK_ADDONS_CHANNEL__`) for `storyRendered`,
   `storyErrored`, `storyThrewException`, `storyMissing` or `playFunctionThrewException`;
3. read the story's parameters with
   `window.__STORYBOOK_PREVIEW__.storyStoreValue.loadStory({ storyId })`;
4. waited for `document.fonts.ready` and every `<img>`, then 100 ms;
5. took an element screenshot of `#storybook-root` with animations disabled and the caret
   hidden, and hashed it.

Three Storybooks, all built with `@storybook/react-native-web-vite` 10.6: the demo (92 stories),
wolf-ui (27) and the pilot app (454). Each was captured twice in a fresh container.

## Results

| | Demo | wolf-ui | Pilot app |
| --- | --- | --- | --- |
| Stories rendered | 92/92 | 27/27 | 454/454 |
| Byte-identical across the two runs | 92 | 27 | 443 |
| Root with no size (empty story) | 2 | 0 | 3 |
| Stories with `parameters.chromatic`, read from the store | 0 | 0 | 41 (some set two) |
| Median time per story, settle included | 362 ms | 351 ms | 415 ms |
| Median time to `storyRendered` | 170 ms | 170 ms | not measured |

- **Render events work.** Every story ended in `storyRendered`. The error events were not
  exercised, since no story errored; the CLI's tests drive them with a scripted page.
- **Parameters are readable without an app-side decorator.** All 41 stories in the pilot app
  that set `parameters.chromatic` came back from the story store: 37 with `modes` (a default and
  a maximum font scale, set through a global), 4 with `delay` and 2 with `disable`. Modes arrive
  as plain objects of globals, ready for W5.
- **Captures are deterministic within one image.** The 11 pilot stories that differed between
  runs are animated success screens and in-progress spinners: the same kind of story that comes
  out `unstable` on iOS, and what `delay` and the double-screenshot check are for.
- **Crops vary in size.** 452 of the pilot's 454 stories use `layout: 'fullscreen'`, and 30 of
  them are at least as tall as the viewport. Component crops change size when their content does,
  which makes the padded diff (W2) necessary.
- **Empty stories exist.** A story whose root has no size (a component that renders nothing in
  that state) has nothing to crop. The capture falls back to the viewport, which comes out blank.
- **Speed.** One page, one story at a time: the pilot's 454 stories take about three minutes.
  Parallel pages can come later.

## Not covered

- Play functions: none of the three Storybooks has one.
- Running on a host browser instead of the image: not measured, and not supported (ADR 0037).
- Firefox and WebKit.
