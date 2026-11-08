import { describe, expect, it } from 'vitest';

import { launchChromium, wrapPage, type PlaywrightModule } from './chromium.adapter.ts';

type Page = Parameters<typeof wrapPage>[0];

/** Records every call a Playwright page receives and answers with canned values. */
function fakePage() {
  const calls: unknown[][] = [];
  const handlers = new Map<string, () => void>();
  const page = {
    addInitScript: (script: string) => {
      calls.push(['addInitScript', script]);
      return Promise.resolve();
    },
    goto: (url: string, options: unknown) => {
      calls.push(['goto', url, options]);
      return Promise.resolve(null);
    },
    evaluate: (expression: string) => {
      calls.push(['evaluate', expression]);
      return Promise.resolve(42);
    },
    screenshot: (options: unknown) => {
      calls.push(['screenshot', options]);
      return Promise.resolve(Buffer.from([1, 2]));
    },
    once: (event: string, listener: () => void) => {
      handlers.set(event, listener);
    },
  };
  return { page: page as unknown as Page, calls, handlers };
}

function fakePlaywright(options: { failLaunch?: Error; failContext?: Error } = {}) {
  const { page, calls } = fakePage();
  const state = { closed: 0, contextOptions: null as unknown };
  const browser = {
    version: () => '141.0.1',
    close: () => {
      state.closed += 1;
      return Promise.resolve();
    },
    newContext: (contextOptions: unknown) => {
      state.contextOptions = contextOptions;
      if (options.failContext) return Promise.reject(options.failContext);
      return Promise.resolve({ newPage: () => Promise.resolve(page) });
    },
  };
  const module = {
    chromium: {
      launch: () =>
        options.failLaunch ? Promise.reject(options.failLaunch) : Promise.resolve(browser),
    },
  };
  return { module: module as unknown as PlaywrightModule, state, calls };
}

const viewport = { width: 1200, height: 900 };

describe('launchChromium', () => {
  it('opens a page with the determinism defaults and names the browser', async () => {
    const { module, state } = fakePlaywright();
    const session = await launchChromium({ viewport, pixelRatio: 2 }, () =>
      Promise.resolve(module),
    );
    expect(session.browser).toBe('chromium 141.0.1');
    expect(state.contextOptions).toEqual({
      viewport,
      deviceScaleFactor: 2,
      reducedMotion: 'reduce',
      colorScheme: 'light',
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    await session.close();
    expect(state.closed).toBe(1);
  });

  it('explains a missing playwright-core', async () => {
    await expect(
      launchChromium({ viewport, pixelRatio: 1 }, () => Promise.reject(new Error('not found'))),
    ).rejects.toThrow(/^web capture needs the playwright-core package/);
  });

  it('explains a browser that will not start, with the first line of the reason', async () => {
    const { module } = fakePlaywright({
      failLaunch: new Error("Executable doesn't exist at /x\nmore detail"),
    });
    await expect(
      launchChromium({ viewport, pixelRatio: 1 }, () => Promise.resolve(module)),
    ).rejects.toThrow(
      "cannot start Chromium (Executable doesn't exist at /x): run in the " +
        'mcr.microsoft.com/playwright image that matches your playwright-core version, or ' +
        'install the browser with `npx playwright-core install chromium`',
    );
    const odd = fakePlaywright({ failLaunch: 'weird' as unknown as Error });
    await expect(
      launchChromium({ viewport, pixelRatio: 1 }, () => Promise.resolve(odd.module)),
    ).rejects.toThrow(/^cannot start Chromium \(weird\)/);
  });

  it('closes the browser when the page cannot be opened', async () => {
    const { module, state } = fakePlaywright({ failContext: new Error('no context') });
    await expect(
      launchChromium({ viewport, pixelRatio: 1 }, () => Promise.resolve(module)),
    ).rejects.toThrow('no context');
    expect(state.closed).toBe(1);
  });
});

describe('wrapPage', () => {
  it('passes each call to the Playwright page', async () => {
    const { page, calls, handlers } = fakePage();
    const wrapped = wrapPage(page);
    await wrapped.addInitScript('init()');
    await wrapped.goto('http://x/a', { timeout: 500 });
    await expect(wrapped.evaluate('1 + 1')).resolves.toBe(42);
    const options = { animations: 'disabled', caret: 'hide', fullPage: false } as const;
    await expect(wrapped.screenshot(options)).resolves.toEqual(new Uint8Array([1, 2]));
    expect(calls).toEqual([
      ['addInitScript', 'init()'],
      ['goto', 'http://x/a', { timeout: 500, waitUntil: 'load' }],
      ['evaluate', '1 + 1'],
      ['screenshot', options],
    ]);
    let gone = 0;
    wrapped.onGone(() => {
      gone += 1;
    });
    handlers.get('crash')?.();
    handlers.get('close')?.();
    expect(gone).toBe(2);
  });
});
