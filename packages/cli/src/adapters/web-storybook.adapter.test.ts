import { describe, expect, it } from 'vitest';

import { FakePage, type ScriptedStory } from './browser-page.fake.ts';
import { WebStorybook } from './web-storybook.adapter.ts';

const baseUrl = 'http://127.0.0.1:6006';
const viewport = { width: 1200, height: 900 };

async function open(stories: Record<string, ScriptedStory>, fetchBody?: unknown) {
  const page = new FakePage(stories);
  const fetchFn = (url: string): Promise<Response> =>
    Promise.resolve(
      url.endsWith('/index.json') && fetchBody !== undefined
        ? Response.json(fetchBody)
        : new Response('missing', { status: 404 }),
    );
  return { page, storybook: await WebStorybook.open(page, { baseUrl, viewport, fetch: fetchFn }) };
}

describe('WebStorybook.getIndex', () => {
  it('lists the stories of index.json and leaves docs out', async () => {
    const { storybook } = await open(
      {},
      {
        v: 5,
        entries: {
          'a--one': { id: 'a--one', title: 'A', name: 'One', type: 'story' },
          'a--docs': { id: 'a--docs', title: 'A', name: 'Docs', type: 'docs' },
          'b--two': { id: 'b--two', title: 'B', name: 'Two' },
        },
      },
    );
    await expect(storybook.getIndex()).resolves.toEqual([
      { id: 'a--one', title: 'A', name: 'One' },
      { id: 'b--two', title: 'B', name: 'Two' },
    ]);
  });

  it('explains a missing or malformed index', async () => {
    const missing = await open({});
    await expect(missing.storybook.getIndex()).rejects.toThrow(
      `${baseUrl}/index.json answered 404: is --storybook a built Storybook (storybook build)?`,
    );
    const malformed = await open({}, { stories: {} });
    await expect(malformed.storybook.getIndex()).rejects.toThrow(/is not a Storybook 7\+ index/);
  });

  it('explains an unreachable Storybook', async () => {
    const page = new FakePage({});
    const storybook = await WebStorybook.open(page, {
      baseUrl,
      viewport,
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });
    await expect(storybook.getIndex()).rejects.toThrow(
      `cannot fetch ${baseUrl}/index.json: is the Storybook reachable?`,
    );
  });
});

describe('WebStorybook.selectStory', () => {
  it('opens the story alone and reports it rendered with its parameters', async () => {
    const { page, storybook } = await open({
      'a--one': { event: 'storyRendered', parameters: { chromatic: { delay: 600 } } },
    });
    await expect(storybook.selectStory('a--one', 1000)).resolves.toEqual({
      kind: 'rendered',
      parameters: { delay: 600, skip: false },
    });
    expect(page.visited).toEqual([`${baseUrl}/iframe.html?id=a--one&viewMode=story`]);
  });

  it('reports a render error with the preview message', async () => {
    const { storybook } = await open({
      'a--bad': { event: 'storyThrewException', payload: { message: 'boom' } },
    });
    await expect(storybook.selectStory('a--bad', 1000)).resolves.toEqual({
      kind: 'error',
      message: 'boom',
    });
  });

  it('reports invalid parameters and a preview without a story store as errors', async () => {
    const { storybook } = await open({
      'a--bad-params': { event: 'storyRendered', parameters: { targus: { delay: -5 } } },
      'a--no-store': { event: 'storyRendered', noStore: true },
    });
    const invalid = await storybook.selectStory('a--bad-params', 1000);
    expect(invalid.kind === 'error' ? invalid.message : '').toMatch(/^invalid parameters\.targus/);
    const noStore = await storybook.selectStory('a--no-store', 1000);
    expect(noStore.kind === 'error' ? noStore.message : '').toMatch(/no story store/);
  });

  it('rejects when the story never renders in time', async () => {
    const { storybook } = await open({ 'a--slow': {} });
    await expect(storybook.selectStory('a--slow', 20)).rejects.toThrow(
      'story a--slow did not render within 20 ms',
    );
  });
});

describe('WebStorybook modes', () => {
  const rendered = { event: 'storyRendered' } as const;

  it('opens a mode with its globals in the URL and resizes only for a viewport', async () => {
    const { page, storybook } = await open({ 'a--one': rendered });
    expect(storybook.supportsModes).toBe(true);
    const dark = { name: 'dark', globals: { theme: 'dark', rtl: false }, viewport: null };
    const phone = { name: 'phone', globals: {}, viewport: { width: 390, height: null } };
    await storybook.selectStory('a--one', 1000, dark);
    await storybook.selectStory('a--one', 1000, phone);
    await storybook.selectStory('a--one', 1000, phone);
    await storybook.selectStory('a--one', 1000);
    expect(page.visited).toEqual([
      `${baseUrl}/iframe.html?id=a--one&viewMode=story&globals=theme:dark;rtl:!false`,
      `${baseUrl}/iframe.html?id=a--one&viewMode=story`,
      `${baseUrl}/iframe.html?id=a--one&viewMode=story`,
      `${baseUrl}/iframe.html?id=a--one&viewMode=story`,
    ]);
    expect(page.resized).toEqual([{ width: 390, height: 900 }, viewport]);
  });

  it('takes both sides of a mode viewport that gives a height', async () => {
    const { page, storybook } = await open({ 'a--one': rendered });
    const tablet = { name: 'tablet', globals: {}, viewport: { width: 768, height: 1024 } };
    await storybook.selectStory('a--one', 1000, tablet);
    expect(page.resized).toEqual([{ width: 768, height: 1024 }]);
  });
});

describe('WebStorybook.screenshot', () => {
  it('crops to the root in whole pixels, over the full page', async () => {
    const { page, storybook } = await open({
      'a--one': { event: 'storyRendered', root: { left: 0.5, top: 0, width: 100.2, height: 1500 } },
    });
    await storybook.selectStory('a--one', 1000);
    const png = await storybook.screenshot();
    expect([...png.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    expect(page.shots).toEqual([
      {
        animations: 'disabled',
        caret: 'hide',
        fullPage: true,
        clip: { x: 0, y: 0, width: 101, height: 1500 },
      },
    ]);
  });

  it('falls back to the viewport for an empty or missing root', async () => {
    const { page, storybook } = await open({
      'a--empty': { event: 'storyRendered', root: { left: 0, top: 0, width: 1200, height: 0 } },
      'a--none': { event: 'storyRendered', root: null },
    });
    await storybook.selectStory('a--empty', 1000);
    await storybook.screenshot();
    await storybook.selectStory('a--none', 1000);
    await storybook.screenshot();
    expect(page.shots).toEqual([
      { animations: 'disabled', caret: 'hide', fullPage: false },
      { animations: 'disabled', caret: 'hide', fullPage: false },
    ]);
  });
});

describe('WebStorybook.whenDisconnected', () => {
  it('resolves when the page crashes', async () => {
    const { page, storybook } = await open({});
    page.crash();
    await expect(storybook.whenDisconnected()).resolves.toBeUndefined();
  });

  it('ignores the page closing after close()', async () => {
    const { page, storybook } = await open({});
    await storybook.close();
    page.crash();
    const settled = await Promise.race([
      storybook.whenDisconnected().then(() => 'gone'),
      new Promise((resolve) => {
        setTimeout(() => {
          resolve('pending');
        }, 10);
      }),
    ]);
    expect(settled).toBe('pending');
  });
});
