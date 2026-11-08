import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createFakeClock } from '@targus/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FakePage, type ScriptedStory } from '../adapters/browser-page.fake.ts';
import type { ChromiumOptions } from '../adapters/chromium.adapter.ts';
import { readCaptureManifest } from '../capture/manifest.ts';
import {
  isStorybookUrl,
  PageGoneError,
  runWebCapture,
  type WebCaptureDeps,
  type WebCaptureOptions,
} from './capture-web.ts';

const index = {
  v: 5,
  entries: {
    'a--one': { id: 'a--one', title: 'A', name: 'One', type: 'story' },
    'a--skip': { id: 'a--skip', title: 'A', name: 'Skip', type: 'story' },
    'b--bad': { id: 'b--bad', title: 'B', name: 'Bad', type: 'story' },
    'b--docs': { id: 'b--docs', title: 'B', name: 'Docs', type: 'docs' },
  },
};

const stories: Record<string, ScriptedStory> = {
  'a--one': { event: 'storyRendered', color: [10, 20, 30, 255] },
  'a--skip': { event: 'storyRendered', parameters: { chromatic: { disableSnapshot: true } } },
  'b--bad': { event: 'storyErrored', payload: { title: 'B', description: 'broke' } },
};

let out: string;
let lines: string[];

beforeEach(async () => {
  out = await mkdtemp(path.join(tmpdir(), 'targus-web-capture-'));
  lines = [];
});

afterEach(async () => {
  await rm(out, { recursive: true, force: true });
});

function options(overrides: Partial<WebCaptureOptions> = {}): WebCaptureOptions {
  return {
    storybook: 'storybook-static',
    out,
    viewport: { width: 1200, height: 900 },
    pixelRatio: 1,
    settle: 0,
    stabilityGap: 0,
    renderTimeout: 1000,
    attempts: 2,
    ...overrides,
  };
}

interface Harness {
  readonly deps: WebCaptureDeps;
  readonly page: FakePage;
  readonly events: string[];
  readonly launched: ChromiumOptions[];
}

function harness(scripted: Record<string, ScriptedStory> = stories): Harness {
  const page = new FakePage(scripted);
  const events: string[] = [];
  const launched: ChromiumOptions[] = [];
  const fetchIndex = (url: string): Promise<Response> =>
    Promise.resolve(
      url.endsWith('/index.json') ? Response.json(index) : new Response('', { status: 404 }),
    );
  const deps: WebCaptureDeps = {
    clock: createFakeClock(),
    fetch: fetchIndex,
    sleep: () => Promise.resolve(),
    log: (line) => lines.push(line),
    launch: (launchOptions) => {
      launched.push(launchOptions);
      events.push('launch');
      return Promise.resolve({
        page,
        browser: 'chromium 141.0.1',
        close: () => {
          events.push('browser closed');
          return Promise.resolve();
        },
      });
    },
    serve: (dir) => {
      events.push(`serve ${path.basename(dir)}`);
      return Promise.resolve({
        url: 'http://127.0.0.1:6006',
        close: () => {
          events.push('server closed');
          return Promise.resolve();
        },
      });
    },
  };
  return { deps, page, events, launched };
}

describe('runWebCapture', () => {
  it('serves the directory, captures every story and writes a web manifest', async () => {
    const { deps, page, events, launched } = harness();
    const manifest = await runWebCapture(options({ pixelRatio: 2 }), deps);

    expect(launched).toEqual([{ viewport: { width: 1200, height: 900 }, pixelRatio: 2 }]);
    expect(page.visited[0]).toBe('http://127.0.0.1:6006/iframe.html?id=a--one&viewMode=story');
    expect(events).toEqual(['serve storybook-static', 'launch', 'browser closed', 'server closed']);
    expect(manifest.summary).toMatchObject({
      platform: 'web',
      device: { udid: null, name: 'chromium 141.0.1' },
      app: null,
      storybook: 'storybook-static',
      viewport: { width: 1200, height: 900 },
      pixelRatio: 2,
      captured: 1,
      failed: 1,
      skipped: ['a--skip'],
    });
    expect(manifest.stories.map((story) => [story.id, story.width, story.height])).toEqual([
      ['a--one', 320, 80],
      ['b--bad', 0, 0],
    ]);
    expect(manifest.stories[1]?.error).toBe('B: broke');
    expect((await readdir(out)).sort()).toEqual(['a--one.png', 'manifest.json']);
    expect(await readCaptureManifest(out)).toEqual(manifest);
    expect(lines[0]).toBe(
      'opening storybook-static in chromium 141.0.1 at 1200x900, pixel ratio 2',
    );
    expect(lines).toContain('2/3 a--skip SKIPPED (parameters.targus.skip)');
    expect(lines).toContain('captured 1/2 stories in 0.0s');
  });

  it('opens a URL as it is, without a server, and honours filter and limit', async () => {
    const { deps, page, events } = harness();
    await runWebCapture(
      options({ storybook: 'https://sb.example.com/', filter: 'a--', limit: 1 }),
      deps,
    );
    expect(events).toEqual(['launch', 'browser closed']);
    expect(page.visited).toEqual(['https://sb.example.com/iframe.html?id=a--one&viewMode=story']);
  });
});

describe('runWebCapture when things go wrong', () => {
  it('marks a story whose screenshots keep changing as unstable', async () => {
    const { deps } = harness({ 'a--one': { event: 'storyRendered', flicker: true } });
    const manifest = await runWebCapture(options({ filter: 'a--one' }), deps);
    expect(manifest.summary.unstable).toEqual(['a--one']);
  });

  it('stops at once when the page crashes, and still closes everything', async () => {
    const { deps, page, events } = harness();
    const slow = { ...deps, sleep: () => new Promise<void>((resolve) => setTimeout(resolve, 5)) };
    const run = runWebCapture(options({ settle: 1 }), slow);
    setTimeout(() => {
      page.crash();
    }, 1);
    await expect(run).rejects.toBeInstanceOf(PageGoneError);
    await expect(run).rejects.toThrow(
      'the browser page crashed or closed after 0 stories; the partial capture was discarded',
    );
    expect(events).toEqual(['serve storybook-static', 'launch', 'browser closed', 'server closed']);
    expect(await readdir(out)).toEqual([]);
  });

  it('closes the server when the browser cannot start', async () => {
    const { deps, events } = harness();
    const failing = { ...deps, launch: () => Promise.reject(new Error('no browser')) };
    await expect(runWebCapture(options(), failing)).rejects.toThrow('no browser');
    expect(events).toEqual(['serve storybook-static', 'server closed']);
  });
});

describe('isStorybookUrl', () => {
  it('tells URLs from directories', () => {
    expect(isStorybookUrl('http://localhost:6006')).toBe(true);
    expect(isStorybookUrl('HTTPS://sb.example.com')).toBe(true);
    expect(isStorybookUrl('storybook-static')).toBe(false);
    expect(isStorybookUrl('./http/storybook')).toBe(false);
  });
});
