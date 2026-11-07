import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { heartbeatIntervalMs, WsStorybookChannel } from './ws-channel.adapter.ts';

interface AppMessage {
  readonly type: string;
  readonly args?: readonly unknown[];
}

/** Storybook's `WebsocketTransport`: 15 s heartbeat interval plus 5 s max latency. */
const storybookTimeoutMs = 20_000;

// Captured before the timers are faked, so a missing message fails the test instead of hanging.
const realSetTimeout = globalThis.setTimeout;

/**
 * The heartbeat of Storybook RN's `WebsocketTransport`: open and every message from the server
 * restart a 20 s timer that closes the socket with code 3008, and a ping is answered with a
 * pong. Resolves with the close code.
 */
function storybookHeartbeat(socket: WebSocket): Promise<number> {
  let timeout: NodeJS.Timeout | undefined;
  const heartbeat = (): void => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      socket.close(3008, 'timeout');
    }, storybookTimeoutMs);
  };
  socket.once('open', heartbeat);
  socket.on('message', (data: Buffer) => {
    heartbeat();
    const message = JSON.parse(data.toString('utf8')) as AppMessage;
    if (message.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
  });
  return new Promise((resolve) => {
    socket.once('close', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

/** A real ws client playing a Storybook RN app with the heartbeat on (its default). */
async function connectStorybookApp(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const closed = storybookHeartbeat(socket);
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
    closed,
    /** The next message from the server, failing after a real second without one. */
    nextMessage: () =>
      new Promise<AppMessage>((resolve, reject) => {
        const message = unread.shift();
        if (message) {
          resolve(message);
          return;
        }
        waiters.push(resolve);
        realSetTimeout(() => {
          reject(new Error('no message from the server within a real second'));
        }, 1000);
      }),
    send: (type: string, ...args: unknown[]) => {
      socket.send(JSON.stringify({ type, args }));
    },
  };
}

let channel: WsStorybookChannel | undefined;

async function listen(): Promise<WsStorybookChannel> {
  channel = await WsStorybookChannel.listen({
    port: 0,
    host: '127.0.0.1',
    connectTimeoutMs: 2000,
    reportGraceMs: 30,
  });
  return channel;
}

beforeEach(() => {
  // Only the timers: the sockets still need real I/O.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});

afterEach(async () => {
  vi.useRealTimers();
  await channel?.close();
  channel = undefined;
});

describe('WsStorybookChannel heartbeat', () => {
  it('pings a connected app before its 20 s heartbeat runs out, and keeps pinging', async () => {
    const server = await listen();
    const app = await connectStorybookApp(server.port);

    expect(heartbeatIntervalMs).toBeLessThan(storybookTimeoutMs * 0.75);
    for (let tick = 1; tick <= 6; tick += 1) {
      await vi.advanceTimersByTimeAsync(heartbeatIntervalMs);
      expect(await app.nextMessage()).toEqual({ type: 'ping' });
    }
    expect(app.socket.readyState).toBe(WebSocket.OPEN);
  });

  it('keeps the app connected through 60 s of a story with no channel traffic', async () => {
    const server = await listen();
    const app = await connectStorybookApp(server.port);
    let disconnected = false;
    void server.whenDisconnected().then(() => (disconnected = true));

    const selection = server.selectStory('slow--story', 120_000);
    expect(await app.nextMessage()).toEqual({
      type: 'setCurrentStory',
      args: [{ storyId: 'slow--story' }],
    });
    for (let elapsed = 0; elapsed < 60_000; elapsed += heartbeatIntervalMs) {
      await vi.advanceTimersByTimeAsync(heartbeatIntervalMs);
      expect((await app.nextMessage()).type).toBe('ping');
    }
    app.send('targus/storyParameters', { storyId: 'slow--story', targus: { delay: 7000 } });

    expect(await selection).toEqual({ kind: 'rendered', parameters: { delay: 7000, skip: false } });
    expect(disconnected).toBe(false);
    expect(app.socket.readyState).toBe(WebSocket.OPEN);
  });
});

describe('WsStorybookChannel heartbeat replies and cleanup', () => {
  it('ignores the pong the app answers with', async () => {
    const server = await listen();
    const app = await connectStorybookApp(server.port);
    const index = server.getIndex();
    expect((await app.nextMessage()).type).toBe('RN_GET_INDEX');

    app.socket.send(JSON.stringify({ type: 'pong' }));
    app.send('RN_GET_INDEX_RESPONSE', {
      index: { entries: { 'a--b': { id: 'a--b', title: 'A', name: 'B', type: 'story' } } },
    });

    expect(await index).toEqual([{ id: 'a--b', title: 'A', name: 'B' }]);
  });

  it('stops pinging an app once it disconnects', async () => {
    const server = await listen();
    const app = await connectStorybookApp(server.port);
    app.socket.close();
    await app.closed;
    await server.whenDisconnected();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer behind when the channel closes', async () => {
    const server = await listen();
    const app = await connectStorybookApp(server.port);

    await server.close();
    channel = undefined;
    await app.closed;

    expect(vi.getTimerCount()).toBe(0);
  });
});
