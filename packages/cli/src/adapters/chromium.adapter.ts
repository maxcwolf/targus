import { TargusError } from '@targus/core';
import type { BrowserType, Page } from 'playwright-core';

import type { BrowserPage } from './web-storybook.adapter.ts';

/** The browser window size a web capture renders at, in CSS pixels. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface ChromiumOptions {
  readonly viewport: Viewport;
  /** Device pixels per CSS pixel; the captures are this many times the CSS size. */
  readonly pixelRatio: number;
}

/** A launched browser with the one page a web capture drives. */
export interface BrowserSession {
  readonly page: BrowserPage;
  /** Browser name and version, e.g. `chromium 141.0.7390.37`; stored as the build's device. */
  readonly browser: string;
  close(): Promise<void>;
}

/** The part of the `playwright-core` module the launcher uses. */
export interface PlaywrightModule {
  readonly chromium: BrowserType;
}

/** `playwright-core` is an optional peer dependency, loaded only for web captures (ADR 0037). */
export const loadPlaywrightCore = (): Promise<PlaywrightModule> => import('playwright-core');

const missingPlaywright =
  'web capture needs the playwright-core package: add it to the project that runs targus ' +
  '(e.g. `yarn add -D playwright-core`), and run in the mcr.microsoft.com/playwright image ' +
  'of the same version';

function launchFailure(error: unknown): TargusError {
  const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
  return new TargusError(
    'bad_request',
    `cannot start Chromium (${reason}): run in the mcr.microsoft.com/playwright image that ` +
      'matches your playwright-core version, or install the browser with ' +
      '`npx playwright install chromium`',
    { cause: error },
  );
}

/** The `BrowserPage` view of a Playwright page. */
export function wrapPage(page: Page): BrowserPage {
  return {
    addInitScript: async (script) => {
      await page.addInitScript(script);
    },
    goto: async (url, { timeout }) => {
      await page.goto(url, { timeout, waitUntil: 'load' });
    },
    evaluate: <T>(expression: string) => page.evaluate<T>(expression),
    screenshot: async (options) => new Uint8Array(await page.screenshot(options)),
    setViewportSize: (size) => page.setViewportSize(size),
    onGone: (listener) => {
      page.once('crash', listener);
      page.once('close', listener);
    },
  };
}

/**
 * Launch headless Chromium with the determinism defaults of ADR 0037: reduced motion, light
 * colour scheme, `en-US` and UTC.
 */
export async function launchChromium(
  options: ChromiumOptions,
  load: () => Promise<PlaywrightModule> = loadPlaywrightCore,
): Promise<BrowserSession> {
  const playwright = await load().catch((error: unknown) => {
    throw new TargusError('bad_request', missingPlaywright, { cause: error });
  });
  const browser = await playwright.chromium.launch().catch((error: unknown) => {
    throw launchFailure(error);
  });
  try {
    const context = await browser.newContext({
      viewport: { width: options.viewport.width, height: options.viewport.height },
      deviceScaleFactor: options.pixelRatio,
      reducedMotion: 'reduce',
      colorScheme: 'light',
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    const page = await context.newPage();
    return {
      page: wrapPage(page),
      browser: `chromium ${browser.version()}`,
      close: () => browser.close(),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
