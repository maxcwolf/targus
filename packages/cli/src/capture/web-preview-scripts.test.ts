import { describe, expect, it } from 'vitest';

import {
  inPage,
  measureElement,
  readStoryOutcome,
  readStoryParameters,
  recordStoryOutcome,
  waitForAssets,
  type OutcomeWindow,
  type PreviewChannel,
} from './web-preview-scripts.ts';

/** A stand-in for Storybook's addons channel: `emit` calls every listener of the event. */
function fakeChannel(): PreviewChannel & { emit(event: string, payload?: unknown): void } {
  const listeners = new Map<string, ((payload?: unknown) => void)[]>();
  return {
    on: (event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    emit: (event, payload) => {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
  };
}

/** Evaluate an `inPage` expression the way the browser would, with `win` as `window`. */
function evaluate(expression: string, win: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the page runs the same text
  const page = new Function('window', `return ${expression}`) as (window: unknown) => unknown;
  return page(win);
}

describe('recordStoryOutcome', () => {
  it('catches the channel Storybook assigns after the script ran', async () => {
    const win: OutcomeWindow = {};
    recordStoryOutcome(win);
    const channel = fakeChannel();
    win.__STORYBOOK_ADDONS_CHANNEL__ = channel;
    expect(win.__STORYBOOK_ADDONS_CHANNEL__).toBe(channel);
    channel.emit('storyRendered');
    channel.emit('storyErrored', { title: 'late', description: 'ignored' });
    await expect(readStoryOutcome(win)).resolves.toEqual({ kind: 'rendered' });
  });

  it('attaches at once to a channel that already exists', async () => {
    const channel = fakeChannel();
    const win: OutcomeWindow = { __STORYBOOK_ADDONS_CHANNEL__: channel };
    recordStoryOutcome(win);
    channel.emit('storyThrewException', { message: 'boom' });
    await expect(readStoryOutcome(win)).resolves.toEqual({ kind: 'error', message: 'boom' });
  });

  it.each([
    ['storyErrored', { title: 'Button', description: 'no args' }, 'Button: no args'],
    ['storyThrewException', 'plain string', 'plain string'],
    ['playFunctionThrewException', { message: 'click failed' }, 'play function: click failed'],
    ['storyMissing', 'ui-button--x', 'Storybook has no story ui-button--x'],
  ])('turns %s into an error message', async (event, payload, message) => {
    const win: OutcomeWindow = {};
    recordStoryOutcome(win);
    const channel = fakeChannel();
    win.__STORYBOOK_ADDONS_CHANNEL__ = channel;
    channel.emit(event, payload);
    await expect(readStoryOutcome(win)).resolves.toEqual({ kind: 'error', message });
  });

  it('runs as page text, then reports through readStoryOutcome', async () => {
    const win: OutcomeWindow = {};
    evaluate(inPage(recordStoryOutcome), win);
    const channel = fakeChannel();
    win.__STORYBOOK_ADDONS_CHANNEL__ = channel;
    channel.emit('storyErrored');
    await expect(evaluate(inPage(readStoryOutcome), win)).resolves.toEqual({
      kind: 'error',
      message: 'undefined: undefined',
    });
  });
});

describe('readStoryOutcome', () => {
  it('reports a page where the init script never ran', async () => {
    await expect(readStoryOutcome({})).resolves.toEqual({
      kind: 'error',
      message: 'the targus init script did not run in the page',
    });
  });
});

describe('readStoryParameters', () => {
  it('reads targus and chromatic, null when absent', async () => {
    const asked: string[] = [];
    const win = {
      __STORYBOOK_PREVIEW__: {
        storyStoreValue: {
          loadStory: ({ storyId }: { storyId: string }) => {
            asked.push(storyId);
            return Promise.resolve({ parameters: { chromatic: { delay: 600 }, layout: 'x' } });
          },
        },
      },
    };
    await expect(evaluate(inPage(readStoryParameters, 'a--b'), win)).resolves.toEqual({
      found: true,
      targus: null,
      chromatic: { delay: 600 },
    });
    expect(asked).toEqual(['a--b']);
  });

  it('treats a story without parameters as setting neither', async () => {
    const win = {
      __STORYBOOK_PREVIEW__: { storyStoreValue: { loadStory: () => Promise.resolve({}) } },
    };
    await expect(readStoryParameters(win, 'a')).resolves.toEqual({
      found: true,
      targus: null,
      chromatic: null,
    });
  });

  it('says so when the preview has no story store', async () => {
    await expect(readStoryParameters({}, 'a')).resolves.toEqual({
      found: false,
      message: 'cannot read story parameters: window.__STORYBOOK_PREVIEW__ has no story store',
    });
  });
});

describe('waitForAssets', () => {
  it('waits for fonts, unfinished images and two frames', async () => {
    const order: string[] = [];
    const pending: (() => void)[] = [];
    const unfinished = {
      complete: false,
      addEventListener: (event: string, listener: () => void) => {
        if (event === 'load') pending.push(listener);
      },
    };
    const win = {
      document: {
        fonts: { ready: Promise.resolve().then(() => order.push('fonts')) },
        images: [{ complete: true, addEventListener: () => undefined }, unfinished],
      },
      requestAnimationFrame: (callback: () => void) => {
        order.push('frame');
        setTimeout(callback, 0);
      },
    };
    const done = waitForAssets(win).then(() => order.push('done'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(order).toEqual(['fonts']);
    for (const listener of pending) listener();
    await done;
    expect(order).toEqual(['fonts', 'frame', 'frame', 'done']);
  });
});

describe('measureElement', () => {
  it('answers the box in page coordinates, or null without the element', () => {
    const rect = { left: 10, top: 20, width: 300, height: 40 };
    const win = {
      scrollX: 5,
      scrollY: 100,
      document: {
        querySelector: (selector: string) =>
          selector === '#root' ? { getBoundingClientRect: () => rect } : null,
      },
    };
    expect(evaluate(inPage(measureElement, '#root'), win)).toEqual({
      x: 15,
      y: 120,
      width: 300,
      height: 40,
    });
    expect(measureElement(win, '#other')).toBeNull();
  });
});

describe('inPage', () => {
  it('calls the function with window and JSON arguments', () => {
    const fn = (win: { n: number }, add: number, label: string): string => `${label}${win.n + add}`;
    expect(inPage(fn, 2, 'n=')).toMatch(/^\(.*\)\(window, 2, "n="\)$/s);
    expect(evaluate(inPage(fn, 2, 'n='), { n: 1 })).toBe('n=3');
  });
});
