---
'@targus/cli': patch
---

Fix `targus run` and `targus capture` failing with a fake "app crashed" on any story that takes
longer than 20 s, for example one with a long `parameters.targus.delay` that needs a stability
retry. Storybook's websocket client closes the connection after 20 s without a message from the
server, and the CLI's channel only spoke when it switched story. The channel server now sends
Storybook's `{ type: 'ping' }` to each connected app every 10 s, as Storybook's own dev server
does, and ignores the app's `pong` reply.
