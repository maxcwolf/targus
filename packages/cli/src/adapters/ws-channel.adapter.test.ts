import { isTargusError } from '@targus/core';
import { afterEach, describe, expect, it } from 'vitest';

import { WsStorybookChannel } from './ws-channel.adapter.ts';
import { connectApp, index } from './ws-channel.scripted-app.ts';

let channel: WsStorybookChannel | undefined;

async function listen(connectTimeoutMs = 2000, reportGraceMs = 30): Promise<WsStorybookChannel> {
  channel = await WsStorybookChannel.listen({
    port: 0,
    host: '127.0.0.1',
    connectTimeoutMs,
    reportGraceMs,
  });
  return channel;
}

afterEach(async () => {
  await channel?.close();
  channel = undefined;
});

describe('WsStorybookChannel', () => {
  it('asks the app for its index and keeps only stories', async () => {
    const server = await listen();
    const indexPromise = server.getIndex();
    const app = await connectApp(server.port);

    const request = await app.nextMessage();
    expect(request).toEqual({ type: 'RN_GET_INDEX', args: [] });
    app.send('someOtherEvent', 'noise');
    app.socket.send('not json');
    app.send('RN_GET_INDEX_RESPONSE', { index });

    expect(await indexPromise).toEqual([
      { id: 'button--primary', title: 'Button', name: 'Primary' },
      { id: 'chat--mine', title: 'Chat', name: 'Mine' },
    ]);
  });

  it('rejects getIndex when the app never connects', async () => {
    const server = await listen(30);

    const index = server.getIndex();

    await expect(index).rejects.toSatisfy(isTargusError);
    await expect(index).rejects.toThrow(
      `the app did not connect within 30ms on port ${server.port}`,
    );
    await expect(index).rejects.toThrow('--connect-timeout');
  });
});

describe('WsStorybookChannel.selectStory', () => {
  it('resolves rendered on storyRendered with the id as a string', async () => {
    const server = await listen();
    const app = await connectApp(server.port);

    const selection = server.selectStory('button--primary', 1000);
    expect(await app.nextMessage()).toEqual({
      type: 'setCurrentStory',
      args: [{ storyId: 'button--primary' }],
    });
    app.send('storyRendered', 'chat--mine');
    app.send('storyRendered', 'button--primary');

    expect(await selection).toEqual({ kind: 'rendered' });
  });

  it('resolves rendered on storyUnchanged with a { storyId } payload', async () => {
    const server = await listen();
    const app = await connectApp(server.port);
    const selection = server.selectStory('chat--mine', 1000);
    await app.nextMessage();
    app.send('storyUnchanged', { storyId: 'chat--mine' });

    expect(await selection).toEqual({ kind: 'rendered' });
  });

  it('resolves error on a matching targus/storyError', async () => {
    const server = await listen();
    const app = await connectApp(server.port);
    const selection = server.selectStory('chat--mine', 1000);
    await app.nextMessage();
    app.send('targus/storyError', { storyId: 'other', message: 'not this one' });
    app.send('targus/storyError', { bad: true });
    app.send('targus/storyError', {
      storyId: 'chat--mine',
      message: 'No QueryClient set',
      stack: null,
      componentStack: null,
    });

    expect(await selection).toEqual({ kind: 'error', message: 'No QueryClient set' });
  });

  it('rejects selectStory on timeout', async () => {
    const server = await listen();
    await connectApp(server.port);

    await expect(server.selectStory('slow', 20)).rejects.toThrow(
      'timeout after 20ms waiting for storyRendered slow',
    );
  });
});

describe('WsStorybookChannel parameters reports', () => {
  it('waits after storyRendered for the decorator and returns the parameters', async () => {
    const server = await listen(2000, 2000);
    const app = await connectApp(server.port);
    const selection = server.selectStory('chat--mine', 1000);
    await app.nextMessage();
    app.send('storyRendered', 'chat--mine');
    app.send('targus/storyParameters', { storyId: 'other', targus: { skip: true } });
    app.send('targus/storyParameters', { storyId: 'chat--mine', targus: { delay: 500 } });

    expect(await selection).toEqual({
      kind: 'rendered',
      parameters: { delay: 500, skip: false },
    });
  });

  it('takes a report that arrives before storyRendered, and skip with delay', async () => {
    const server = await listen();
    const app = await connectApp(server.port);
    const selection = server.selectStory('chat--mine', 1000);
    await app.nextMessage();
    app.send('targus/storyParameters', { bad: true });
    app.send('targus/storyParameters', { storyId: 'chat--mine', targus: { delay: 0, skip: true } });

    expect(await selection).toEqual({ kind: 'rendered', parameters: { delay: 0, skip: true } });
  });

  it('records an invalid parameters.targus as an error', async () => {
    const server = await listen();
    const app = await connectApp(server.port);
    const selection = server.selectStory('chat--mine', 1000);
    await app.nextMessage();
    app.send('storyRendered', 'chat--mine');
    app.send('targus/storyParameters', { storyId: 'chat--mine', targus: { delay: 60_000 } });

    const result = await selection;
    expect(result.kind === 'error' && result.message).toMatch(/^invalid parameters\.targus: delay/);
  });

  it('catches a render error the decorator reports after storyRendered', async () => {
    const server = await listen(2000, 2000);
    const app = await connectApp(server.port);
    const selection = server.selectStory('chat--mine', 1000);
    await app.nextMessage();
    app.send('storyRendered', 'chat--mine');
    app.send('targus/storyError', { storyId: 'chat--mine', message: 'boom' });

    expect(await selection).toEqual({ kind: 'error', message: 'boom' });
  });
});

describe('WsStorybookChannel payloads without parameters', () => {
  it('reads a report without a targus key, and a telejson-encoded undefined, as defaults', async () => {
    const server = await listen();
    const app = await connectApp(server.port);
    const none = server.selectStory('chat--none', 1000);
    await app.nextMessage();
    // What the decorator sends for a story that sets no `parameters.targus`.
    app.send('targus/storyParameters', { storyId: 'chat--none' });
    expect(await none).toEqual({ kind: 'rendered', parameters: { delay: null, skip: false } });

    const first = server.selectStory('chat--mine', 1000);
    await app.nextMessage();
    // What Storybook's channel sends for `{ storyId, targus: undefined }` and for a story whose
    // `parameters.targus` is `{ delay: undefined, skip: true }`.
    app.send('targus/storyParameters', { storyId: 'chat--mine', targus: '_undefined_' });
    expect(await first).toEqual({ kind: 'rendered', parameters: { delay: null, skip: false } });

    const second = server.selectStory('chat--other', 1000);
    await app.nextMessage();
    app.send('targus/storyParameters', {
      storyId: 'chat--other',
      targus: { delay: '_undefined_', skip: true, nested: ['_undefined_'] },
    });
    expect(await second).toEqual({ kind: 'rendered', parameters: { delay: null, skip: true } });
  });
});

describe('WsStorybookChannel disconnect during the report wait', () => {
  it('never reports rendered once the app drops, and close() ends the wait', async () => {
    const graceMs = 50;
    const server = await listen(2000, graceMs);
    const app = await connectApp(server.port);
    let outcome: unknown = 'pending';
    const selection = server.selectStory('chat--mine', 10_000).then(
      (value) => (outcome = { value }),
      (error: unknown) => (outcome = { error }),
    );
    await app.nextMessage();
    app.send('targus/storyParameters', { storyId: 'other', targus: {} });
    app.send('storyRendered', 'chat--mine');
    app.socket.close();
    await server.whenDisconnected();
    await new Promise((resolve) => setTimeout(resolve, graceMs * 4));

    expect(outcome).toBe('pending');
    await server.close();
    channel = undefined;
    await selection;
    expect(outcome).toEqual({ error: new Error('channel closed') });
  });
});

describe('WsStorybookChannel cached and missing reports', () => {
  it('uses a report sent before the selection when the story is already on screen', async () => {
    const server = await listen(2000, 2000);
    const app = await connectApp(server.port);
    app.send('targus/storyParameters', { storyId: 'chat--mine', targus: { skip: true } });
    // The report is cached only once it is received; a round trip through the server proves it.
    const indexed = server.getIndex();
    await app.nextMessage();
    app.send('RN_GET_INDEX_RESPONSE', { index });
    await indexed;

    const selection = server.selectStory('chat--mine', 1000);
    await app.nextMessage();
    app.send('storyUnchanged', { storyId: 'chat--mine' });

    expect(await selection).toEqual({ kind: 'rendered', parameters: { delay: null, skip: true } });
  });

  it('stops waiting for reports after the first miss when the app has no decorator', async () => {
    const graceMs = 1000;
    const server = await listen(2000, graceMs);
    const app = await connectApp(server.port);
    const select = async (storyId: string) => {
      const selection = server.selectStory(storyId, 5000);
      await app.nextMessage();
      app.send('storyRendered', storyId);
      const started = performance.now();
      const result = await selection;
      return { result, waitedMs: performance.now() - started };
    };

    const first = await select('button--primary');
    const second = await select('chat--mine');

    expect(first.result).toEqual({ kind: 'rendered' });
    expect(first.waitedMs).toBeGreaterThanOrEqual(graceMs - 50);
    expect(second.result).toEqual({ kind: 'rendered' });
    expect(second.waitedMs).toBeLessThan(graceMs / 2);
  });
});

describe('WsStorybookChannel lifecycle', () => {
  it('rejects pending waits and disconnects the app on close', async () => {
    const server = await listen();
    const app = await connectApp(server.port);
    const closed = new Promise((resolve) => app.socket.once('close', resolve));
    const pending = server.selectStory('never', 5000);

    await server.close();
    channel = undefined;

    await expect(pending).rejects.toThrow('channel closed');
    await closed;
  });

  it('ends a wait for the app to connect on close', async () => {
    const server = await listen(60_000);
    const index = server.getIndex();

    await server.close();
    channel = undefined;

    await expect(index).rejects.toThrow('channel closed');
  });

  it('resolves whenDisconnected once the app drops its last connection', async () => {
    const server = await listen();
    const first = await connectApp(server.port);
    const second = await connectApp(server.port);
    let disconnected = false;
    void server.whenDisconnected().then(() => (disconnected = true));

    first.socket.close();
    await new Promise((resolve) => first.socket.once('close', resolve));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(disconnected).toBe(false);
    second.socket.terminate();

    await server.whenDisconnected();
    expect(disconnected).toBe(true);
  });

  it('does not count its own close as the app disconnecting', async () => {
    const server = await listen();
    const app = await connectApp(server.port);
    let disconnected = false;
    void server.whenDisconnected().then(() => (disconnected = true));

    await server.close();
    channel = undefined;
    await new Promise((resolve) => app.socket.once('close', resolve));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(disconnected).toBe(false);
  });

  it('fails to listen on a port that is taken', async () => {
    const server = await listen();

    await expect(
      WsStorybookChannel.listen({ port: server.port, host: '127.0.0.1', connectTimeoutMs: 10 }),
    ).rejects.toThrow('EADDRINUSE');
  });
});
