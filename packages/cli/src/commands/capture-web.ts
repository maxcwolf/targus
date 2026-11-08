import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { isBlankPng, TargusError, type Clock } from '@targus/core';

import {
  launchChromium,
  type BrowserSession,
  type ChromiumOptions,
  type Viewport,
} from '../adapters/chromium.adapter.ts';
import { serveDirectory, type StaticServer } from '../adapters/static-server.adapter.ts';
import { systemClock } from '../adapters/system-clock.adapter.ts';
import { WebStorybook } from '../adapters/web-storybook.adapter.ts';
import { captureStories, type CaptureReport } from '../capture/capture-stories.ts';
import { compareWithCore } from '../capture/compare-images.ts';
import { writeCaptureOutput, type CaptureManifest } from '../capture/manifest.ts';
import { sha256Hex } from '../capture/png.ts';
import { formatCaptureSummary, progressLine } from './capture.ts';

export interface WebCaptureOptions {
  /** A built Storybook directory, or the URL of a running one. */
  readonly storybook: string;
  readonly out: string;
  readonly viewport: Viewport;
  readonly pixelRatio: number;
  readonly settle: number;
  readonly stabilityGap: number;
  readonly renderTimeout: number;
  readonly attempts: number;
  readonly filter?: string;
  readonly limit?: number;
}

export interface WebCaptureDeps {
  readonly clock: Clock;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (line: string) => void;
  readonly launch: (options: ChromiumOptions) => Promise<BrowserSession>;
  readonly serve: (dir: string) => Promise<StaticServer>;
  /** Fetches `index.json`; the global `fetch` when unset. */
  readonly fetch?: (url: string) => Promise<Response>;
}

export const defaultWebCaptureDeps: WebCaptureDeps = {
  clock: systemClock,
  sleep: (ms) => delay(ms),
  log: (line) => {
    process.stdout.write(`${line}\n`);
  },
  launch: (options) => launchChromium(options),
  serve: (dir) => serveDirectory(dir),
};

/** Whether `--storybook` names a running Storybook rather than a directory. */
export function isStorybookUrl(storybook: string): boolean {
  return /^https?:\/\//i.test(storybook);
}

/** The base URL to open: the URL as given, or a local server for the directory. */
async function openSource(
  storybook: string,
  deps: WebCaptureDeps,
): Promise<{ readonly url: string; readonly server: StaticServer | null }> {
  if (isStorybookUrl(storybook)) return { url: storybook.replace(/\/+$/, ''), server: null };
  const server = await deps.serve(path.resolve(storybook));
  return { url: server.url, server };
}

/** The browser page crashed or was closed during a capture. Stops the run at once. */
export class PageGoneError extends TargusError {
  override readonly name = 'PageGoneError';

  constructor(done: number) {
    super(
      'internal',
      `the browser page crashed or closed after ${done} stories; the partial capture was ` +
        'discarded',
    );
  }
}

function captureWhilePageLives(
  storybook: WebStorybook,
  options: WebCaptureOptions,
  deps: WebCaptureDeps,
): Promise<CaptureReport> {
  const controller = new AbortController();
  let done = 0;
  const gone = storybook.whenDisconnected().then(() => {
    throw new PageGoneError(done);
  });
  const work = captureStories({
    channel: storybook,
    driver: storybook,
    options: {
      settleMs: options.settle,
      stabilityGapMs: options.stabilityGap,
      renderTimeoutMs: options.renderTimeout,
      maxAttempts: options.attempts,
      ...(options.filter === undefined ? {} : { filter: options.filter }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
    },
    clock: deps.clock,
    sleep: deps.sleep,
    hash: sha256Hex,
    compareImages: compareWithCore,
    isBlank: isBlankPng,
    signal: controller.signal,
    onProgress: (progress) => {
      done = progress.index + 1;
      deps.log(progressLine(progress));
    },
  });
  return Promise.race([work, gone]).finally(() => {
    controller.abort();
  });
}

/**
 * `targus capture --platform web`: open every story of a built Storybook in headless Chromium,
 * screenshot its root and write `<out>/<storyId>.png` plus `manifest.json` (ADR 0037).
 */
export async function runWebCapture(
  options: WebCaptureOptions,
  deps: WebCaptureDeps = defaultWebCaptureDeps,
): Promise<CaptureManifest> {
  const outDir = path.resolve(options.out);
  const source = await openSource(options.storybook, deps);
  let session: BrowserSession | null = null;
  try {
    session = await deps.launch({ viewport: options.viewport, pixelRatio: options.pixelRatio });
    const { width, height } = options.viewport;
    deps.log(
      `opening ${options.storybook} in ${session.browser} at ${width}x${height}, ` +
        `pixel ratio ${options.pixelRatio}`,
    );
    const storybook = await WebStorybook.open(session.page, {
      baseUrl: source.url,
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    });
    const report = await captureWhilePageLives(storybook, options, deps);
    await storybook.close();
    const manifest = await writeCaptureOutput(outDir, report, {
      platform: 'web',
      browser: session.browser,
      storybook: options.storybook,
      viewport: options.viewport,
      pixelRatio: options.pixelRatio,
      settleMs: options.settle,
      stabilityGapMs: options.stabilityGap,
    });
    for (const line of formatCaptureSummary(manifest)) deps.log(line);
    return manifest;
  } finally {
    await session?.close();
    await source.server?.close();
  }
}
