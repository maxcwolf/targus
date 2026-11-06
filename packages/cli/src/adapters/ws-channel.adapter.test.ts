import { isTargusError } from '@targus/core';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { WsStorybookChannel } from './ws-channel.adapter.ts';

interface AppMessage {
  readonly type: string;
  readonly args: readonly unknown[];
}

/** A real ws client playing the Storybook RN app. */
async function connectApp(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  // Messages not yet taken by nextMessage(); the server may speak before the test listens.
  const unread: AppMessage[] = [];
  const waiters: ((message: AppMessage) => void)[] = [];
  socket.on('message', (data: Buffer) => {
    const message = JSON.parse(data.toString('utf8')) as AppMessage;
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else unread.push(message);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => {
      resolve();
    });
    socket.once('error', reject);
  });
  return {
    socket,
    nextMessage: () =>
      new Promise<AppMessage>((resolve) => {
        const message = unread.shift();
        if (message) resolve(message);
        else waiters.push(resolve);
      }),
    send: (type: string, ...args: unknown[]) => {
      socket.send(JSON.stringify({ type, args }));
    },
  };
}

const index = {
  v: 5,
  entries: {
    'button--primary': { type: 'story', id: 'button--primary', title: 'Button', name: 'Primary' },
    'button--docs': { type: 'docs', id: 'button--docs', title: 'Button', name: 'Docs' },
    'chat--mine': { type: 'story', id: 'chat--mine', title: 'Chat', name: 'Mine', tags: [] },
  },
};

let channel: WsStorybookChannel | undefined;

async function listen(connectTimeoutMs = 2000): Promise<WsStorybookChannel> {
  channel = await WsStorybookChannel.listen({ port: 0, host: '127.0.0.1', connectTimeoutMs });
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
