// react-test-renderer is deprecated upstream but still the lightest renderer that runs a React
// tree in plain Node without react-native installed; it is only used to drive these tests.
/* eslint-disable @typescript-eslint/no-deprecated */
import { act, createElement, useState, type ReactElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it } from 'vitest';

import { onDevice, StoryTree } from './on-device.ts';

beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

/** A two-state toggle, as a story would render it: host elements with handlers and labels. */
function Toggle({ label = 'Closed' }: { readonly label?: string }): ReactElement {
  const [closed, setClosed] = useState(false);
  const [presses, setPresses] = useState(0);
  return createElement(
    'View',
    null,
    createElement('Text', null, `${closed ? 'closed' : 'open'} after ${String(presses)}`),
    createElement('Pressable', {
      accessibilityLabel: label,
      onPress: () => {
        setClosed(true);
        setPresses(presses + 1);
      },
    }),
    createElement('Pressable', { testID: 'off', disabled: true, onPress: () => undefined }),
    createElement('Pressable', {
      'aria-label': 'Reopen',
      onPress: () => {
        setClosed(false);
      },
    }),
  );
}

function Field(): ReactElement {
  const [value, setValue] = useState('');
  return createElement('TextInput', { placeholder: 'Project name', value, onChangeText: setValue });
}

const inStory = (storyId: string, child: ReactElement): ReactElement =>
  createElement(StoryTree, { storyId, children: child });

async function mount(element: ReactElement): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(element);
    return Promise.resolve();
  });
  if (renderer === undefined) throw new Error('renderer was not created');
  return renderer;
}

const textOf = (renderer: ReactTestRenderer): string => JSON.stringify(renderer.toJSON());
const quick = { timeoutMs: 48 };

describe('onDevice press', () => {
  it("calls the onPress of the story's element with that accessibility label", async () => {
    const renderer = await mount(inStory('toggle--a', createElement(Toggle)));

    await act(() => onDevice({ id: 'toggle--a' }).press('Closed'));

    expect(textOf(renderer)).toContain('closed after 1');
  });

  it('finds an element by aria-label, and sees the props of the latest render', async () => {
    const renderer = await mount(inStory('toggle--b', createElement(Toggle)));
    const device = onDevice({ id: 'toggle--b' });

    await act(() => device.press('Closed'));
    await act(() => device.press('Closed'));
    await act(() => device.press('Reopen'));

    // A handler from a stale render would count from 0 again.
    expect(textOf(renderer)).toContain('open after 2');
  });

  it('waits for its own story, not the one still mounted before it', async () => {
    const renderer = await mount(inStory('toggle--old', createElement(Toggle)));
    const pressed = onDevice({ id: 'toggle--new' }).press('Closed');

    await act(() => {
      renderer.update(inStory('toggle--new', createElement(Toggle, { key: 'new' })));
      return Promise.resolve();
    });
    await act(() => pressed);

    expect(textOf(renderer)).toContain('closed after 1');
  });

  it('fails when the story is never mounted', async () => {
    await expect(onDevice({ id: 'toggle--none' }, quick).press('Closed')).rejects.toThrow(
      'the story was not mounted within 48 ms (story toggle--none)',
    );
  });

  it('fails when nothing enabled has that name and an onPress', async () => {
    const renderer = await mount(inStory('toggle--c', createElement(Toggle)));
    const device = onDevice({ id: 'toggle--c' }, quick);

    await expect(device.press('Missing')).rejects.toThrow(
      'no element named "Missing" has onPress within 48 ms (story toggle--c)',
    );
    await expect(device.press('off')).rejects.toThrow('no element named "off" has onPress');

    await act(() => {
      renderer.unmount();
      return Promise.resolve();
    });
    await expect(device.press('Closed')).rejects.toThrow('the story was not mounted');
  });
});

describe('onDevice changeText', () => {
  it('calls onChangeText of the input with that placeholder', async () => {
    const renderer = await mount(inStory('field--a', createElement(Field)));

    await act(() => onDevice({ id: 'field--a' }).changeText('Project name', 'Website redesign'));

    expect(textOf(renderer)).toContain('"value":"Website redesign"');
  });
});

describe('StoryTree', () => {
  it('renders nothing without children, and keeps a newer tree of the same story', async () => {
    const first = await mount(createElement(StoryTree, { storyId: 'tree--a' }));
    expect(first.toJSON()).toBeNull();

    const second = await mount(inStory('tree--a', createElement(Toggle)));
    await act(() => {
      first.unmount();
      return Promise.resolve();
    });
    await act(() => onDevice({ id: 'tree--a' }).press('Closed'));

    expect(textOf(second)).toContain('closed after 1');
  });

  it('follows its story id when Storybook reuses it for the next story', async () => {
    const renderer = await mount(inStory('tree--b', createElement(Toggle)));
    await act(() => {
      renderer.update(inStory('tree--c', createElement(Toggle)));
      renderer.update(inStory('tree--c', createElement(Toggle)));
      return Promise.resolve();
    });

    await expect(onDevice({ id: 'tree--b' }, quick).press('Closed')).rejects.toThrow('not mounted');
    await act(() => onDevice({ id: 'tree--c' }).press('Closed'));

    expect(textOf(renderer)).toContain('closed after 1');
  });
});
