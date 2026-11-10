import { afterEach, describe, expect, it } from 'vitest';

import { WsStorybookChannel } from './ws-channel.adapter.ts';
import { connectApp, type ScriptedApp } from './ws-channel.scripted-app.ts';

// A device that runs play functions (ADR 0047): the story mounts and reports its parameters
// while its play function is still running, and `storyRendered` follows the play function.

let channel: WsStorybookChannel | undefined;

async function selecting(storyId: string) {
  channel = await WsStorybookChannel.listen({
    port: 0,
    host: '127.0.0.1',
    connectTimeoutMs: 2000,
    reportGraceMs: 2000,
  });
  const app = await connectApp(channel.port);
  let answered = false;
  const selection = channel.selectStory(storyId, 1000).finally(() => {
    answered = true;
  });
  await app.nextMessage();
  return { app, selection, isAnswered: () => answered };
}

afterEach(async () => {
  await channel?.close();
  channel = undefined;
});

const phase = (app: ScriptedApp, storyId: string, newPhase: string): void => {
  app.send('storyRenderPhaseChanged', { storyId, newPhase });
};

/** Long enough for the channel to have read what the app sent. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

describe('WsStorybookChannel with a play function', () => {
  it('waits past the parameters report for storyRendered, then answers with the parameters', async () => {
    const { app, selection, isAnswered } = await selecting('toggle--played');
    phase(app, 'toggle--played', 'rendering');
    phase(app, 'toggle--played', 'playing');
    app.send('targus/storyParameters', { storyId: 'toggle--played', targus: { delay: 50 } });
    await settle();
    expect(isAnswered()).toBe(false);

    app.send('storyRendered', 'toggle--played');

    expect(await selection).toEqual({ kind: 'rendered', parameters: { delay: 50, skip: false } });
  });

  it('answers at once with a render error, playing or not', async () => {
    const { app, selection } = await selecting('toggle--broken');
    phase(app, 'toggle--broken', 'playing');
    app.send('targus/storyError', { storyId: 'toggle--broken', message: 'boom' });

    expect(await selection).toEqual({ kind: 'error', message: 'boom' });
  });

  it('records a play function that threw as an error of the story', async () => {
    const { app, selection } = await selecting('toggle--failed');
    phase(app, 'toggle--failed', 'playing');
    app.send('targus/storyParameters', { storyId: 'toggle--failed' });
    app.send('playFunctionThrewException', { name: 'Error', message: 'no element named "Save"' });

    expect(await selection).toEqual({
      kind: 'error',
      message: 'play function: no element named "Save"',
    });
  });

  it('says so when the play function threw nothing readable', async () => {
    const { app, selection } = await selecting('toggle--failed');
    app.send('playFunctionThrewException');

    expect(await selection).toEqual({
      kind: 'error',
      message: 'play function: it threw without a message',
    });
  });

  it("ignores another story's phases and a phase it cannot read", async () => {
    const { app, selection } = await selecting('toggle--plain');
    phase(app, 'toggle--other', 'playing');
    app.send('storyRenderPhaseChanged', 'playing');
    phase(app, 'toggle--plain', 'rendering');
    app.send('targus/storyParameters', { storyId: 'toggle--plain' });

    expect(await selection).toMatchObject({ kind: 'rendered' });
  });
});
