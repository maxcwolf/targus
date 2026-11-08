/**
 * Functions that run inside the browser page of a web capture (ADR 0037). Each one is sent to
 * the page as source text by `inPage`, so it must be self-contained: no imports, no references
 * to anything outside its own body. Each takes the page's `window` as its first argument, which
 * lets the unit tests call it in Node with a fake window.
 *
 * They rely on two Storybook preview globals that are not a public API:
 * `__STORYBOOK_ADDONS_CHANNEL__` (render events) and `__STORYBOOK_PREVIEW__` (story parameters).
 */

/** How the preview said a story ended: it rendered, or it failed with this message. */
export type PreviewOutcome =
  { readonly kind: 'rendered' } | { readonly kind: 'error'; readonly message: string };

export interface PreviewChannel {
  on(event: string, listener: (payload?: unknown) => void): void;
}

export interface OutcomeWindow {
  __STORYBOOK_ADDONS_CHANNEL__?: PreviewChannel;
  __targusOutcome?: Promise<PreviewOutcome>;
}

/**
 * Runs before Storybook's own scripts (an init script) and records the first render or error
 * event of the story the page opened in `window.__targusOutcome`. The channel does not exist yet
 * at that point, so a setter catches the moment Storybook assigns it.
 */
export function recordStoryOutcome(win: OutcomeWindow): void {
  const events = [
    'storyRendered',
    'storyErrored',
    'storyThrewException',
    'playFunctionThrewException',
    'storyMissing',
  ];
  let settle: (outcome: PreviewOutcome) => void = () => undefined;
  win.__targusOutcome = new Promise((resolve) => {
    settle = resolve;
  });
  const describe = (event: string, payload: unknown): string => {
    const value = (payload ?? {}) as { message?: unknown; title?: unknown; description?: unknown };
    if (event === 'storyMissing') return `Storybook has no story ${String(payload)}`;
    if (event === 'storyErrored') return `${String(value.title)}: ${String(value.description)}`;
    const message = typeof value.message === 'string' ? value.message : String(payload);
    return event === 'playFunctionThrewException' ? `play function: ${message}` : message;
  };
  const attach = (channel: PreviewChannel): void => {
    for (const event of events) {
      channel.on(event, (payload) => {
        settle(
          event === 'storyRendered'
            ? { kind: 'rendered' }
            : { kind: 'error', message: describe(event, payload) },
        );
      });
    }
  };
  let channel = win.__STORYBOOK_ADDONS_CHANNEL__;
  if (channel !== undefined) {
    attach(channel);
    return;
  }
  Object.defineProperty(win, '__STORYBOOK_ADDONS_CHANNEL__', {
    configurable: true,
    enumerable: true,
    get: () => channel,
    set: (value: PreviewChannel) => {
      channel = value;
      attach(value);
    },
  });
}

/** The outcome `recordStoryOutcome` recorded; resolves once the story rendered or failed. */
export function readStoryOutcome(win: OutcomeWindow): Promise<PreviewOutcome> {
  return (
    win.__targusOutcome ??
    Promise.resolve({ kind: 'error', message: 'the targus init script did not run in the page' })
  );
}

export interface ParametersWindow {
  __STORYBOOK_PREVIEW__?: {
    storyStoreValue?: {
      loadStory(input: { storyId: string }): Promise<{ parameters?: Record<string, unknown> }>;
    };
  };
}

/** A story's raw `parameters.targus` and `parameters.chromatic`, or why they could not be read. */
export type StoryParametersRead =
  | { readonly found: true; readonly targus: unknown; readonly chromatic: unknown }
  | { readonly found: false; readonly message: string };

/** Read the story's parameters from the preview's story store. */
export async function readStoryParameters(
  win: ParametersWindow,
  storyId: string,
): Promise<StoryParametersRead> {
  const store = win.__STORYBOOK_PREVIEW__?.storyStoreValue;
  if (store === undefined) {
    return {
      found: false,
      message: 'cannot read story parameters: window.__STORYBOOK_PREVIEW__ has no story store',
    };
  }
  const story = await store.loadStory({ storyId });
  const parameters = story.parameters ?? {};
  return {
    found: true,
    targus: parameters.targus ?? null,
    chromatic: parameters.chromatic ?? null,
  };
}

interface PageImage {
  readonly complete: boolean;
  addEventListener(event: 'load' | 'error', listener: () => void, options: { once: true }): void;
}

export interface AssetsWindow {
  readonly document: {
    readonly fonts: { readonly ready: Promise<unknown> };
    readonly images: ArrayLike<PageImage>;
  };
  requestAnimationFrame(callback: () => void): unknown;
}

/** Wait for web fonts, every image, and two animation frames so the result is painted. */
export async function waitForAssets(win: AssetsWindow): Promise<void> {
  await win.document.fonts.ready;
  await Promise.all(
    Array.from(win.document.images, (image) =>
      image.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
          }),
    ),
  );
  await new Promise<void>((resolve) => {
    win.requestAnimationFrame(() => win.requestAnimationFrame(resolve));
  });
}

/** A rectangle in page coordinates (scroll included), in CSS pixels. */
export interface PageBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MeasureWindow {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly document: {
    querySelector(selector: string): {
      getBoundingClientRect(): { left: number; top: number; width: number; height: number };
    } | null;
  };
}

/** The box of the element `selector` names, or `null` when there is no such element. */
export function measureElement(win: MeasureWindow, selector: string): PageBox | null {
  const element = win.document.querySelector(selector);
  if (element === null) return null;
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + win.scrollX,
    y: rect.top + win.scrollY,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * The expression that calls `fn` in the page with `window` and `args`. Arguments travel as
 * JSON, so only plain values can be passed.
 */
export function inPage(fn: (win: never, ...args: never[]) => unknown, ...args: unknown[]): string {
  const rest = args.map((arg) => `, ${JSON.stringify(arg)}`).join('');
  return `(${fn.toString()})(window${rest})`;
}
