import {
  parseCaptureParameters,
  TargusError,
  type StoryIndexEntry,
  type StorybookChannel,
  type StorySelection,
} from '@targus/core';

import { parseStorybookIndex, storyUrl } from '../capture/storybook-index.ts';
import {
  inPage,
  measureElement,
  readStoryOutcome,
  readStoryParameters,
  recordStoryOutcome,
  waitForAssets,
  type PageBox,
  type PreviewOutcome,
  type StoryParametersRead,
} from '../capture/web-preview-scripts.ts';

/** The screenshot options the web capture uses; a subset of Playwright's. */
export interface PageScreenshotOptions {
  readonly clip?: PageBox;
  readonly fullPage: boolean;
  readonly animations: 'disabled';
  readonly caret: 'hide';
}

/**
 * The browser page a web capture drives: the few Playwright `Page` methods it needs, so the
 * adapter can be tested without a browser. `chromium.adapter.ts` wraps a real page into it.
 */
export interface BrowserPage {
  addInitScript(script: string): Promise<void>;
  goto(url: string, options: { readonly timeout: number }): Promise<void>;
  evaluate<T>(expression: string): Promise<T>;
  screenshot(options: PageScreenshotOptions): Promise<Uint8Array>;
  /** Call `listener` once if the page crashes or closes. */
  onGone(listener: () => void): void;
}

export interface WebStorybookOptions {
  /** Base URL of the built Storybook, without a trailing slash. */
  readonly baseUrl: string;
  /** The element a capture is cropped to (ADR 0037). */
  readonly rootSelector?: string;
  readonly fetch?: (url: string) => Promise<Response>;
}

/** Storybook renders every story into this element. */
export const storybookRootSelector = '#storybook-root';

function timeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });
  return Promise.race([work, expired]).finally(() => {
    clearTimeout(timer);
  });
}

/** Whole device pixels around a box, so the crop never cuts into the story. */
function pixelClip(box: PageBox): PageBox {
  const x = Math.floor(box.x);
  const y = Math.floor(box.y);
  return {
    x,
    y,
    width: Math.ceil(box.x + box.width) - x,
    height: Math.ceil(box.y + box.height) - y,
  };
}

/**
 * The Storybook channel of a web capture, on a browser page (ADR 0037): each story is opened as
 * `iframe.html?id=…`, its render or error event decides the selection, and its parameters come
 * from the preview's story store. It also takes the screenshots, cropped to the story's root.
 */
export class WebStorybook implements StorybookChannel {
  private readonly gone: Promise<void>;
  private closing = false;

  private constructor(
    private readonly page: BrowserPage,
    private readonly options: WebStorybookOptions,
  ) {
    this.gone = new Promise((resolve) => {
      page.onGone(() => {
        if (!this.closing) resolve();
      });
    });
  }

  /** Prepare `page` so every story it opens reports how it ended. */
  static async open(page: BrowserPage, options: WebStorybookOptions): Promise<WebStorybook> {
    await page.addInitScript(inPage(recordStoryOutcome));
    return new WebStorybook(page, options);
  }

  async getIndex(): Promise<readonly StoryIndexEntry[]> {
    const url = `${this.options.baseUrl}/index.json`;
    const response = await (this.options.fetch ?? fetch)(url).catch((error: unknown) => {
      throw new TargusError('bad_request', `cannot fetch ${url}: is the Storybook reachable?`, {
        cause: error,
      });
    });
    if (!response.ok) {
      throw new TargusError(
        'bad_request',
        `${url} answered ${response.status}: is --storybook a built Storybook (storybook build)?`,
      );
    }
    return parseStorybookIndex(await response.json(), url);
  }

  async selectStory(storyId: string, timeoutMs: number): Promise<StorySelection> {
    await this.page.goto(storyUrl(this.options.baseUrl, storyId), { timeout: timeoutMs });
    const outcome = await timeout(
      this.page.evaluate<PreviewOutcome>(inPage(readStoryOutcome)),
      timeoutMs,
      `story ${storyId} did not render within ${timeoutMs} ms`,
    );
    if (outcome.kind === 'error') return outcome;
    const read = await this.page.evaluate<StoryParametersRead>(
      inPage(readStoryParameters, storyId),
    );
    if (!read.found) return { kind: 'error', message: read.message };
    const parsed = parseCaptureParameters(read);
    if (!parsed.ok) return { kind: 'error', message: parsed.message };
    await this.page.evaluate(inPage(waitForAssets));
    return { kind: 'rendered', parameters: parsed.parameters };
  }

  /**
   * The story's root element, or the viewport when the root has no size (a story that renders
   * nothing). A root taller than the viewport is captured whole.
   */
  async screenshot(): Promise<Uint8Array> {
    const selector = this.options.rootSelector ?? storybookRootSelector;
    const box = await this.page.evaluate<PageBox | null>(inPage(measureElement, selector));
    const base = { animations: 'disabled', caret: 'hide' } as const;
    if (box === null || box.width < 1 || box.height < 1) {
      return this.page.screenshot({ ...base, fullPage: false });
    }
    return this.page.screenshot({ ...base, fullPage: true, clip: pixelClip(box) });
  }

  whenDisconnected(): Promise<void> {
    return this.gone;
  }

  /** Stop treating the page closing as a crash; the browser session closes the page itself. */
  close(): Promise<void> {
    this.closing = true;
    return Promise.resolve();
  }
}
