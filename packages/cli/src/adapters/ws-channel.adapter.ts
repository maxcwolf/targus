import type { AddressInfo } from 'node:net';

import {
  TargusError,
  type StoryIndexEntry,
  type StorybookChannel,
  type StorySelection,
} from '@targus/core';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { z } from 'zod';

import { formatDuration } from '../duration.ts';

/** One message on the Storybook channel: plain JSON `{ type, args }` (ADR 0008). */
const ChannelEvent = z.object({ type: z.string(), args: z.array(z.unknown()).default([]) });
type ChannelEvent = z.infer<typeof ChannelEvent>;

const IndexResponse = z.object({
  index: z.object({
    entries: z.record(
      z.string(),
      z.object({ id: z.string(), title: z.string(), name: z.string(), type: z.string() }),
    ),
  }),
});

const StoryErrorPayload = z.object({ storyId: z.string(), message: z.string() });

const renderedEvents = new Set(['storyRendered', 'storyUnchanged']);
const indexRetryMs = 1000;

export interface WsStorybookChannelOptions {
  /** Port the app connects to; Storybook RN defaults to 7007. Pass 0 for any free port. */
  readonly port: number;
  readonly host?: string;
  /** How long `getIndex` waits for the app to connect and answer. */
  readonly connectTimeoutMs: number;
}

type Listener = (event: ChannelEvent) => void;

function notConnected(port: number, timeoutMs: number): TargusError {
  return new TargusError(
    'internal',
    `the app did not connect within ${formatDuration(timeoutMs)} on port ${port}: check that ` +
      'it launched, was bundled with EXPO_PUBLIC_TARGUS=true and uses this port, or raise ' +
      '--connect-timeout',
  );
}

/**
 * `StorybookChannel` adapter: hosts the websocket server Storybook RN's app connects to when
 * `enableWebsockets` is on, and speaks its `{ type, args }` protocol directly. It does not load
 * `@storybook/react-native`; the protocol is small and the spike pinned it down.
 */
export class WsStorybookChannel implements StorybookChannel {
  private readonly clients = new Set<WebSocket>();
  private readonly listeners = new Set<Listener>();
  private readonly pending = new Set<(error: Error) => void>();
  private readonly disconnected: Promise<void>;
  private markDisconnected = (): void => undefined;
  private closing = false;

  private constructor(
    private readonly server: WebSocketServer,
    private readonly connectTimeoutMs: number,
  ) {
    this.disconnected = new Promise((resolve) => {
      this.markDisconnected = resolve;
    });
    server.on('connection', (socket) => {
      this.clients.add(socket);
      socket.on('close', () => {
        this.clients.delete(socket);
        if (this.clients.size === 0 && !this.closing) this.markDisconnected();
      });
      socket.on('message', (data) => {
        this.dispatch(data);
      });
    });
  }

  /** Start the server and resolve once it is listening. */
  static listen({
    port,
    host,
    connectTimeoutMs,
  }: WsStorybookChannelOptions): Promise<WsStorybookChannel> {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer(host === undefined ? { port } : { port, host });
      server.once('error', reject);
      server.once('listening', () => {
        server.off('error', reject);
        resolve(new WsStorybookChannel(server, connectTimeoutMs));
      });
    });
  }

  /** The port the server is bound to (useful when it was started on port 0). */
  get port(): number {
    return (this.server.address() as AddressInfo).port;
  }

  async getIndex(): Promise<readonly StoryIndexEntry[]> {
    await this.waitForClient();
    const response = this.waitFor(
      (event) => {
        if (event.type !== 'RN_GET_INDEX_RESPONSE') return undefined;
        const parsed = IndexResponse.safeParse(event.args[0]);
        return parsed.success ? parsed.data.index.entries : undefined;
      },
      this.connectTimeoutMs,
      'RN_GET_INDEX_RESPONSE',
    );
    // The app may connect before its channel listeners are attached; ask again until it answers.
    const ask = (): void => {
      this.send('RN_GET_INDEX', []);
    };
    ask();
    const retry = setInterval(ask, indexRetryMs);
    const entries = await response.finally(() => {
      clearInterval(retry);
    });
    return Object.values(entries)
      .filter((entry) => entry.type === 'story')
      .map(({ id, title, name }) => ({ id, title, name }));
  }

  selectStory(storyId: string, timeoutMs: number): Promise<StorySelection> {
    const selection = this.waitFor(
      (event) => selectionFor(event, storyId),
      timeoutMs,
      `storyRendered ${storyId}`,
    );
    this.send('setCurrentStory', [{ storyId }]);
    return selection;
  }

  whenDisconnected(): Promise<void> {
    return this.disconnected;
  }

  close(): Promise<void> {
    this.closing = true;
    for (const reject of this.pending) reject(new Error('channel closed'));
    for (const client of this.clients) client.terminate();
    return new Promise((resolve, reject) => {
      this.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private dispatch(data: RawData): void {
    let json: unknown;
    try {
      json = JSON.parse(rawText(data));
    } catch {
      return;
    }
    const event = ChannelEvent.safeParse(json);
    if (!event.success) return;
    for (const listener of [...this.listeners]) listener(event.data);
  }

  private send(type: string, args: readonly unknown[]): void {
    const payload = JSON.stringify({ type, args });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }

  private waitForClient(): Promise<void> {
    if (this.clients.size > 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      // close() ends the wait too, so a run stopped early is not held open by this timer.
      const fail = (error: Error): void => {
        clearTimeout(timer);
        this.server.off('connection', onConnection);
        this.pending.delete(fail);
        reject(error);
      };
      const timer = setTimeout(() => {
        fail(notConnected(this.port, this.connectTimeoutMs));
      }, this.connectTimeoutMs);
      const onConnection = (): void => {
        clearTimeout(timer);
        this.pending.delete(fail);
        resolve();
      };
      this.server.once('connection', onConnection);
      this.pending.add(fail);
    });
  }

  private waitFor<T>(
    match: (event: ChannelEvent) => T | undefined,
    timeoutMs: number,
    label: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const settle = (): void => {
        clearTimeout(timer);
        this.listeners.delete(listener);
        this.pending.delete(fail);
      };
      const fail = (error: Error): void => {
        settle();
        reject(error);
      };
      const listener: Listener = (event) => {
        const value = match(event);
        if (value === undefined) return;
        settle();
        resolve(value);
      };
      const timer = setTimeout(() => {
        fail(new Error(`timeout after ${timeoutMs}ms waiting for ${label}`));
      }, timeoutMs);
      this.listeners.add(listener);
      this.pending.add(fail);
    });
  }
}

/** `storyRendered`/`storyUnchanged` carry the id as a string or as `{ storyId }`. */
function selectionFor(event: ChannelEvent, storyId: string): StorySelection | undefined {
  const [first] = event.args;
  if (renderedEvents.has(event.type) && eventStoryId(first) === storyId)
    return { kind: 'rendered' };
  if (event.type !== 'targus/storyError') return undefined;
  const error = StoryErrorPayload.safeParse(first);
  if (!error.success || error.data.storyId !== storyId) return undefined;
  return { kind: 'error', message: error.data.message };
}

function eventStoryId(value: unknown): string | null {
  if (typeof value === 'string') return value;
  const parsed = z.object({ storyId: z.string() }).safeParse(value);
  return parsed.success ? parsed.data.storyId : null;
}

function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString('utf8');
  return data.toString('utf8');
}
