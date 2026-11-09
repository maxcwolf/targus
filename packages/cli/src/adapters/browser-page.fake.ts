import { encodeSolidPng, type Rgba } from '../capture/solid-png.fake.ts';
import type { BrowserPage, PageScreenshotOptions, ViewportSize } from './web-storybook.adapter.ts';

/** How the fake preview answers a story: the event it emits, its payload and parameters. */
export interface ScriptedStory {
  readonly event?: string;
  readonly payload?: unknown;
  readonly parameters?: Record<string, unknown>;
  readonly root?: { left: number; top: number; width: number; height: number } | null;
  readonly noStore?: boolean;
  /** Colour of the screenshots (white by default); `flicker` alternates it on every shot. */
  readonly color?: Rgba;
  readonly flicker?: boolean;
}

/** Size of a viewport screenshot; small so tests stay fast. */
export const fakeViewportShot = { width: 4, height: 3 };

/**
 * A page that runs the real in-page scripts against a fresh fake window per navigation, the way
 * a browser would run them against Storybook's preview: init scripts first, then the preview
 * assigns its channel and emits the scripted event.
 */
export class FakePage implements BrowserPage {
  readonly visited: string[] = [];
  readonly shots: PageScreenshotOptions[] = [];
  readonly resized: ViewportSize[] = [];
  private readonly initScripts: string[] = [];
  private win: Record<string, unknown> = {};
  private goneListener: () => void = () => undefined;
  private current: ScriptedStory = {};

  constructor(private readonly stories: Readonly<Record<string, ScriptedStory>>) {}

  addInitScript(script: string): Promise<void> {
    this.initScripts.push(script);
    return Promise.resolve();
  }

  goto(url: string): Promise<void> {
    this.visited.push(url);
    const id = new URL(url).searchParams.get('id') ?? '';
    const story = this.stories[id] ?? {};
    this.current = story;
    const listeners = new Map<string, (payload?: unknown) => void>();
    this.win = this.windowFor(story);
    for (const script of this.initScripts) this.run(script);
    this.win.__STORYBOOK_ADDONS_CHANNEL__ = {
      on: (event: string, listener: (payload?: unknown) => void) => listeners.set(event, listener),
    };
    if (story.event !== undefined) {
      const { event, payload } = story;
      setTimeout(() => listeners.get(event)?.(payload), 1);
    }
    return Promise.resolve();
  }

  evaluate<T>(expression: string): Promise<T> {
    return Promise.resolve(this.run(expression) as T);
  }

  setViewportSize(size: ViewportSize): Promise<void> {
    this.resized.push(size);
    return Promise.resolve();
  }

  screenshot(options: PageScreenshotOptions): Promise<Uint8Array> {
    this.shots.push(options);
    const { width, height } = options.clip ?? fakeViewportShot;
    const color = this.current.color ?? [255, 255, 255, 255];
    const flipped: Rgba = [255 - color[0], color[1], color[2], color[3]];
    const odd = this.shots.length % 2 === 1;
    return Promise.resolve(
      encodeSolidPng(width, height, this.current.flicker === true && odd ? flipped : color),
    );
  }

  onGone(listener: () => void): void {
    this.goneListener = listener;
  }

  crash(): void {
    this.goneListener();
  }

  private run(expression: string): unknown {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- stands in for the browser
    const page = new Function('window', `return ${expression}`) as (win: unknown) => unknown;
    return page(this.win);
  }

  private windowFor(story: ScriptedStory): Record<string, unknown> {
    const root =
      story.root === undefined ? { left: 0, top: 0, width: 320, height: 80 } : story.root;
    const store = {
      loadStory: () => Promise.resolve({ parameters: story.parameters ?? {} }),
    };
    return {
      scrollX: 0,
      scrollY: 0,
      requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
      document: {
        fonts: { ready: Promise.resolve() },
        images: [],
        querySelector: () => (root === null ? null : { getBoundingClientRect: () => root }),
      },
      ...(story.noStore === true ? {} : { __STORYBOOK_PREVIEW__: { storyStoreValue: store } }),
    };
  }
}
