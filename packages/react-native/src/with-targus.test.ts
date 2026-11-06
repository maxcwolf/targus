// react-test-renderer is deprecated upstream but still the lightest renderer that runs a React
// tree in plain Node without react-native installed; it is only used to drive these tests.
/* eslint-disable @typescript-eslint/no-deprecated */
import { act, createElement, type ReactElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TargusErrorBoundary, type StoryErrorReport } from './error-boundary.ts';
import {
  createChannelEmit,
  createWithTargus,
  resolveStorybookChannel,
  storyErrorEvent,
  withTargus,
  type TargusChannel,
} from './with-targus.ts';

const addonsStoreKey = '__STORYBOOK_ADDONS_PREVIEW';

function Broken(): ReactElement {
  throw new Error('No QueryClient set');
}

function Healthy(): ReactElement {
  return createElement('Text', null, 'hello');
}

async function render(element: ReactElement): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  // The promise-returning overload of act flushes effects and the error boundary's update.
  await act(() => {
    renderer = create(element);
    return Promise.resolve();
  });
  if (renderer === undefined) throw new Error('renderer was not created');
  return renderer;
}

beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  // React logs every error a boundary catches; the tests assert on the report instead.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, addonsStoreKey);
});

describe('TargusErrorBoundary', () => {
  it('reports a throwing child exactly once and renders nothing', async () => {
    const reports: StoryErrorReport[] = [];
    const renderer = await render(
      createElement(TargusErrorBoundary, {
        storyId: 'chat--broken',
        report: (report) => reports.push(report),
        children: createElement(Broken),
      }),
    );

    expect(renderer.toJSON()).toBeNull();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ storyId: 'chat--broken', message: 'No QueryClient set' });
    expect(reports[0]?.stack).toContain('No QueryClient set');
    expect(reports[0]?.componentStack).toContain('Broken');
  });

  it('reports a non-Error throw with its string form and no stack', async () => {
    const reports: StoryErrorReport[] = [];
    function ThrowsString(): ReactElement {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the case under test
      throw 'plain string';
    }
    await render(
      createElement(TargusErrorBoundary, {
        storyId: 's',
        report: (report) => reports.push(report),
        children: createElement(ThrowsString),
      }),
    );

    expect(reports).toEqual([
      expect.objectContaining({ storyId: 's', message: 'plain string', stack: null }),
    ]);
  });
});

describe('TargusErrorBoundary without errors', () => {
  it('renders a healthy child through', async () => {
    const report = vi.fn();
    const renderer = await render(
      createElement(TargusErrorBoundary, {
        storyId: 's',
        report,
        children: createElement(Healthy),
      }),
    );

    expect(renderer.toJSON()).toMatchObject({ type: 'Text', children: ['hello'] });
    expect(report).not.toHaveBeenCalled();
  });

  it('renders null when it has no children', async () => {
    const renderer = await render(
      createElement(TargusErrorBoundary, { storyId: 's', report: vi.fn() }),
    );

    expect(renderer.toJSON()).toBeNull();
  });
});

describe('createWithTargus', () => {
  it('emits targus/storyError with the story id from the decorator context', async () => {
    const emit = vi.fn();
    const decorator = createWithTargus({ emit });

    const renderer = await render(decorator(Broken, { id: 'chat--broken' }));

    expect(renderer.toJSON()).toBeNull();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      storyErrorEvent,
      expect.objectContaining({ storyId: 'chat--broken', message: 'No QueryClient set' }),
    );
  });

  it('renders a healthy story unchanged and emits nothing', async () => {
    const emit = vi.fn();

    const renderer = await render(createWithTargus({ emit })(Healthy, { id: 'ok' }));

    expect(renderer.toJSON()).toMatchObject({ type: 'Text' });
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('createChannelEmit', () => {
  const report: StoryErrorReport = {
    storyId: 's',
    message: 'boom',
    stack: null,
    componentStack: null,
  };

  it('resolves the channel at report time', () => {
    const send = vi.fn();
    const live: { channel?: TargusChannel } = {};
    const emit = createChannelEmit(() => live.channel);

    emit(storyErrorEvent, report);
    live.channel = { emit: send };
    emit(storyErrorEvent, report);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(storyErrorEvent, report);
  });

  it('defaults to the Storybook addons store on globalThis', () => {
    const send = vi.fn();
    Reflect.set(globalThis, addonsStoreKey, { getChannel: () => ({ emit: send }) });

    createChannelEmit()(storyErrorEvent, report);

    expect(send).toHaveBeenCalledWith(storyErrorEvent, report);
  });
});

describe('resolveStorybookChannel', () => {
  it('returns undefined when Storybook is absent or its channel is malformed', () => {
    expect(resolveStorybookChannel()).toBeUndefined();
    Reflect.set(globalThis, addonsStoreKey, { getChannel: () => ({}) });
    expect(resolveStorybookChannel()).toBeUndefined();
  });
});

describe('withTargus', () => {
  it('does not throw when a story errors and Storybook is not running', async () => {
    const renderer = await render(withTargus(Broken, { id: 'x' }));

    expect(renderer.toJSON()).toBeNull();
  });
});
