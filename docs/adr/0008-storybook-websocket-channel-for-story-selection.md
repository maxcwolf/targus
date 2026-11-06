# 0008. Storybook websocket channel for story selection

## Status

accepted, amended by [0022](0022-story-parameters-reported-by-the-decorator.md)

## Amended by

The channel still drives selection. These parts of the text below were overtaken:

- **What a selection waits for.** `storyRendered` arrives before React renders the story, so when
  the app runs `withTargus` the CLI also waits, briefly, for the decorator's
  `targus/storyParameters` or `targus/storyError` report, and applies `parameters.targus`
  before the settle (ADR 0022).
- **How the CLI hosts the channel** (built this way from the first CLI commit, b9c34aa, with no
  ADR of its own). The CLI does not load `@storybook/react-native` or its `createChannelServer`.
  `WsStorybookChannel` (`packages/cli/src/adapters/ws-channel.adapter.ts`) runs its own `ws`
  server on `--port` (default 7007) and speaks the `{ type, args }` protocol directly, so
  nothing ties the CLI to the consumer's Storybook RN version.

## Date

2026-11-04

## Context

The capture loop must select each story, know when it has rendered, and read the list of
stories the app actually loaded. docs/capture-spike.md found that Storybook RN 10 ships the needed
primitive: `@storybook/react-native/node` exports `createChannelServer`. When `enableWebsockets`
is on, the app connects to it as a websocket client, and every message from one client is
relayed to the others as plain JSON `{ type, args }`. The package also offers
`POST /select-story-sync/:id`, but that endpoint uses a fixed 1 s render timeout.

## Decision

We will drive stories through Storybook RN's channel server. The CLI hosts the server on
`ws://localhost:7007`, holds its own socket, asks for the index with `RN_GET_INDEX`, sends
`setCurrentStory`, and waits for `storyRendered`, or `storyUnchanged` when the story is already
on screen. It then applies the settle logic (delay, double screenshot, `unstable` on mismatch).

The CLI resolves `@storybook/react-native` from the consumer project's `node_modules` so the
server and the app bundle share a protocol version. In the pilot app, `.rnstorybook/index.tsx` passes
`enableWebsockets` (the spike also passed `onDeviceUI: false` and `shouldPersistSelection:
false`) when `EXPO_PUBLIC_TARGUS` is set.

Confirmed by the capture spike (docs/capture-spike.md): 354 the pilot app stories captured with no channel
failures, `storyRendered` arriving within milliseconds of `setCurrentStory`. The deep-link
fallback (`simctl openurl` with `?STORYBOOK_STORY_ID=`) is not planned. Two limits found:
`storyRendered` marks React commit, not paint, so a settle delay remains necessary; and
Storybook's error boundary emits nothing on the channel, so the targus decorator reports
render errors itself.

## Consequences

### Positive

- Story selection and commit are signalled by the app; only the paint settle is a timed wait.
- The index comes from the running app, so captured story ids match what was bundled.
- `ChannelServer` sits behind a port, so the loop is tested with a fake app client.

### Negative

- targus depends on Storybook RN's channel protocol, which may change between versions.
- The consumer app needs a targus-specific Storybook configuration.

## Alternatives considered

- **`POST /select-story-sync/:id`.** Rejected because of its fixed 1 s render timeout.
- **Deep link via `simctl openurl`.** Kept as the fallback; it needs a fixed wait and gives no
  render signal.
