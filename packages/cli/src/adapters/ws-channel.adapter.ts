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
import {
  ChannelEvent,
  isTargusEvent,
  renderSignalFor,
  targusReport,
  targusReportFor,
} from './channel-events.ts';

const IndexResponse = z.object({
  index: z.object({
    entries: z.record(
      z.string(),
      z.object({ id: z.string(), title: z.string(), name: z.string(), type: z.string() }),
    ),
  }),
});

const indexRetryMs = 1000;

/**
 * How often each connected app gets Storybook's `{ type: 'ping' }`. Storybook's
 * `WebsocketTransport` closes the socket with code 3008 after 20 s without a message (its 15 s
 * heartbeat interval plus 5 s latency), and the channel only speaks when it switches story, so
 * a story slower than that would drop the app and ADR 0021 would call it a crash. Storybook's
 * own server pings every 15 s; this leaves more room for a busy simulator.
 */
export const heartbeatIntervalMs = 10_000;
const ping = JSON.stringify({ type: 'ping' });

/** How long a selection waits after `storyRendered` for the decorator's report (ADR 0022). */
export const defaultReportGraceMs = 1000;

export interface WsStorybookChannelOptions {
  /** Port the app connects to; Storybook RN defaults to 7007. Pass 0 for any free port. */
  readonly port: number;
  readonly host?: string;
  /** How long `getIndex` waits for the app to connect and answer. */
  readonly connectTimeoutMs: number;
  /** How long to wait after `storyRendered` for `targus/storyParameters`. */
  readonly reportGraceMs?: number;
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
 * `@storybook/react-native`; the protocol is small and the capture spike pinned it down.
 */
export class WsStorybookChannel implements StorybookChannel {
  private readonly clients = new Set<WebSocket>();
  private readonly listeners = new Set<Listener>();
  private readonly pending = new Set<(error: Error) => void>();
  /**
   * The decorator's report per story, kept even when no selection waits: the report can land in
   * the same socket read as `storyRendered`, or before a selection of a story that is already on
   * screen. A render error is never replaced by a later non-error report, since the decorator
   * may send the story's parameters after it (ADR 0004: an error fails the build); selecting
   * the story again clears it, unless Storybook answers that the story on screen is unchanged.
   */
  private readonly reports = new Map<string, StorySelection>();
  /** Whether the app runs `withTargus`: unknown until a targus event or a missed report. */
  private decorator: boolean | null = null;
  private readonly disconnected: Promise<void>;
  private markDisconnected = (): void => undefined;
  private closing = false;

  private constructor(
    private readonly server: WebSocketServer,
    private readonly connectTimeoutMs: number,
    private readonly reportGraceMs: number,
  ) {
    this.disconnected = new Promise((resolve) => {
      this.markDisconnected = resolve;
    });
    server.on('connection', (socket) => {
      this.clients.add(socket);
      const heartbeat = setInterval(() => {
        socket.send(ping);
      }, heartbeatIntervalMs);
      socket.on('close', () => {
        clearInterval(heartbeat);
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
    reportGraceMs = defaultReportGraceMs,
  }: WsStorybookChannelOptions): Promise<WsStorybookChannel> {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer(host === undefined ? { port } : { port, host });
      server.once('error', reject);
      server.once('listening', () => {
        server.off('error', reject);
        resolve(new WsStorybookChannel(server, connectTimeoutMs, reportGraceMs));
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

  /**
   * Storybook RN emits `storyRendered` before React renders the story, so once it arrives the
   * selection waits up to `reportGraceMs` for the decorator's `targus/storyParameters` (or
   * `targus/storyError`). An app without the decorator never reports; after its first miss
   * the channel stops waiting, until a targus event shows the decorator after all.
   */
  async selectStory(storyId: string, timeoutMs: number): Promise<StorySelection> {
    // A fresh render reports afresh, so an earlier report, an error above all, must not answer
    // for it. Only `storyUnchanged` says the earlier render is still what the screen shows.
    const earlier = this.reports.get(storyId);
    this.reports.delete(storyId);
    const first = this.waitFor(
      (event) => renderSignalFor(event, storyId) ?? targusReportFor(event, storyId),
      timeoutMs,
      `storyRendered ${storyId}`,
    );
    this.send('setCurrentStory', [{ storyId }]);
    const signal = await first;
    if (typeof signal !== 'string') return signal;
    if (signal === 'unchanged' && earlier !== undefined) this.remember(storyId, earlier);
    return this.reportAfterRender(storyId);
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

  private async reportAfterRender(storyId: string): Promise<StorySelection> {
    const cached = this.reports.get(storyId);
    if (cached !== undefined) return cached;
    if (this.decorator === false) return { kind: 'rendered' };
    const grace = this.waitFor(
      (event) => targusReportFor(event, storyId),
      this.reportGraceMs,
      `targus/storyParameters ${storyId}`,
      null,
    );
    // An app that drops the channel during the grace wait has not rendered anything: answer
    // nothing, like a render wait, so the crash watch (ADR 0021) ends the run and close()
    // rejects this wait, rather than reporting the story as rendered when the grace runs out.
    const gone = this.disconnected.then(() => 'disconnected' as const);
    const report = await Promise.race([grace, gone]);
    if (report === 'disconnected') return this.unanswered();
    if (report !== null) return report;
    this.decorator ??= false;
    return { kind: 'rendered' };
  }

  /** A wait that only `close()` ends, by rejecting it. */
  private unanswered(): Promise<never> {
    return new Promise((_resolve, reject) => {
      this.pending.add(reject);
    });
  }

  /** Remember what the decorator says, whether or not a selection is waiting for it. */
  private observe(event: ChannelEvent): void {
    if (isTargusEvent(event)) this.decorator = true;
    const report = targusReport(event);
    if (report !== undefined) this.remember(report.storyId, report.selection);
  }

  /** Keep `selection` as the story's report, unless that would hide a render error. */
  private remember(storyId: string, selection: StorySelection): void {
    if (selection.kind !== 'error' && this.reports.get(storyId)?.kind === 'error') return;
    this.reports.set(storyId, selection);
  }

  private dispatch(data: RawData): void {
    let json: unknown;
    try {
      json = JSON.parse(rawText(data));
    } catch {
      return;
    }
    const event = ChannelEvent.safeParse(json);
    // The app answers each ping with `{ type: 'pong' }`; it carries nothing for a wait.
    if (!event.success || event.data.type === 'pong') return;
    this.observe(event.data);
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

  /** Resolve on the first event `match` maps to a value; on timeout reject, or yield `onTimeout`. */
  private waitFor<T>(
    match: (event: ChannelEvent) => T | undefined,
    timeoutMs: number,
    label: string,
    onTimeout?: T,
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
        if (onTimeout === undefined) {
          fail(new Error(`timeout after ${timeoutMs}ms waiting for ${label}`));
          return;
        }
        settle();
        resolve(onTimeout);
      }, timeoutMs);
      this.listeners.add(listener);
      this.pending.add(fail);
    });
  }
}

function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString('utf8');
  return data.toString('utf8');
}
