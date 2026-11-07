import { WebSocket } from 'ws';

interface AppMessage {
  readonly type: string;
  readonly args: readonly unknown[];
}

/** Test-only: a real ws client playing the Storybook RN app. */
export async function connectApp(port: number) {
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

/** A story index as Storybook RN's `RN_GET_INDEX_RESPONSE` carries it. */
export const index = {
  v: 5,
  entries: {
    'button--primary': { type: 'story', id: 'button--primary', title: 'Button', name: 'Primary' },
    'button--docs': { type: 'docs', id: 'button--docs', title: 'Button', name: 'Docs' },
    'chat--mine': { type: 'story', id: 'chat--mine', title: 'Chat', name: 'Mine', tags: [] },
  },
};

export type ScriptedApp = Awaited<ReturnType<typeof connectApp>>;
