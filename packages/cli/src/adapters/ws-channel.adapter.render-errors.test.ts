import { afterEach, describe, expect, it } from 'vitest';

import { WsStorybookChannel } from './ws-channel.adapter.ts';
import { connectApp, index, type ScriptedApp } from './ws-channel.scripted-app.ts';

let channel: WsStorybookChannel | undefined;

async function listen(): Promise<WsStorybookChannel> {
  channel = await WsStorybookChannel.listen({
    port: 0,
    host: '127.0.0.1',
    connectTimeoutMs: 2000,
    reportGraceMs: 2000,
  });
  return channel;
}

afterEach(async () => {
  await channel?.close();
  channel = undefined;
});

/**
 * What the app sends for a story that throws, in the order a `withTargus` decorator whose
 * parameters reporter wraps the error boundary sends it: Storybook's `storyRendered` first, then
 * the boundary's error, then the reporter's parameters.
 */
function throwingRender(app: ScriptedApp, storyId: string): void {
  app.send('storyRendered', storyId);
  app.send('targus/storyError', { storyId, message: 'boom', stack: null, componentStack: null });
  app.send('targus/storyParameters', { storyId, targus: { delay: 50 } });
}

/** Wait until the server has read everything the app sent: a round trip through it proves it. */
async function flush(server: WsStorybookChannel, app: ScriptedApp): Promise<void> {
  const indexed = server.getIndex();
  await app.nextMessage();
  app.send('RN_GET_INDEX_RESPONSE', { index });
  await indexed;
}

describe('WsStorybookChannel render error followed by parameters', () => {
  it('keeps the error when both reports were read before the selection', async () => {
    const server = await listen();
    const app = await connectApp(server.port);
    throwingRender(app, 'chat--mine');
    await flush(server, app);

    const selection = server.selectStory('chat--mine', 1000);
    await app.nextMessage();
    app.send('storyUnchanged', { storyId: 'chat--mine' });

    expect(await selection).toEqual({ kind: 'error', message: 'boom' });
  });

  it('keeps the error when the story renders, throws and reports during the selection', async () => {
    const server = await listen();
    const app = await connectApp(server.port);
    const selection = server.selectStory('chat--mine', 1000);
    await app.nextMessage();
    throwingRender(app, 'chat--mine');

    expect(await selection).toEqual({ kind: 'error', message: 'boom' });
  });

  it('forgets the error when a new selection renders the story cleanly', async () => {
    const server = await listen();
    const app = await connectApp(server.port);
    throwingRender(app, 'chat--mine');
    await flush(server, app);

    const selection = server.selectStory('chat--mine', 1000);
    await app.nextMessage();
    app.send('storyRendered', 'chat--mine');
    app.send('targus/storyParameters', { storyId: 'chat--mine', targus: { delay: 50 } });

    expect(await selection).toEqual({ kind: 'rendered', parameters: { delay: 50, skip: false } });
  });

  it('lets an error replace the parameters of a story that is still on screen', async () => {
    const server = await listen();
    const app = await connectApp(server.port);
    app.send('targus/storyParameters', { storyId: 'chat--mine', targus: { skip: true } });
    await flush(server, app);

    const selection = server.selectStory('chat--mine', 1000);
    await app.nextMessage();
    app.send('storyUnchanged', { storyId: 'chat--mine' });
    app.send('targus/storyError', { storyId: 'chat--mine', message: 'late' });

    expect(await selection).toEqual({ kind: 'error', message: 'late' });
  });
});
