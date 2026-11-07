import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useHotkeys } from './useHotkeys.ts';

function setup(): { j: () => void; arrow: () => void } {
  const keys = { j: vi.fn(), ArrowRight: vi.fn() };
  renderHook(() => {
    useHotkeys(keys);
  });
  return { j: keys.j, arrow: keys.ArrowRight };
}

/** Append `html` to the page and return its first element, focused. */
function focused(html: string, selector?: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  const element = selector ? host.querySelector(selector) : host.firstElementChild;
  if (!(element instanceof HTMLElement)) throw new Error(`no element in ${html}`);
  element.focus();
  return element;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useHotkeys', () => {
  it('runs the handler for a key pressed on the page and claims the event', () => {
    const { j } = setup();
    expect(fireEvent.keyDown(window, { key: 'j' })).toBe(false);
    expect(j).toHaveBeenCalledOnce();
  });

  it('ignores keys with a modifier held and keys it has no handler for', () => {
    const { j } = setup();
    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'j', altKey: true });
    expect(fireEvent.keyDown(window, { key: 'x' })).toBe(true);
    expect(j).not.toHaveBeenCalled();
  });
});

describe('useHotkeys with a key held down', () => {
  it('keeps repeating a key by default', () => {
    const { j } = setup();
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'j', repeat: true });
    expect(j).toHaveBeenCalledTimes(2);
  });

  it('acts once per press for a key that does not repeat, still claiming the repeats', () => {
    const keys = { a: vi.fn(), j: vi.fn() };
    renderHook(() => {
      useHotkeys(keys, ['a']);
    });
    expect(fireEvent.keyDown(window, { key: 'a' })).toBe(false);
    expect(fireEvent.keyDown(window, { key: 'a', repeat: true })).toBe(false);
    fireEvent.keyDown(window, { key: 'a', repeat: true });
    fireEvent.keyDown(window, { key: 'j', repeat: true });
    expect(keys.a).toHaveBeenCalledOnce();
    expect(keys.j).toHaveBeenCalledOnce();

    fireEvent.keyDown(window, { key: 'a' });
    expect(keys.a).toHaveBeenCalledTimes(2);
  });
});

describe('useHotkeys with a focused control', () => {
  it.each([
    ['a text input', '<input type="text">', undefined],
    ['a search field', '<input type="search">', undefined],
    ['an untyped input', '<input>', undefined],
    ['a textarea', '<textarea></textarea>', undefined],
    ['a select', '<select><option>one</option></select>', undefined],
    ['an editable region', '<div contenteditable="true" tabindex="0"></div>', undefined],
    ['text inside an editable region', '<div contenteditable><b tabindex="0">x</b></div>', 'b'],
  ])('never fires while typing in %s', (_name, html, selector) => {
    const { j, arrow } = setup();
    const field = focused(html, selector);
    expect(fireEvent.keyDown(field, { key: 'j' })).toBe(true);
    expect(fireEvent.keyDown(field, { key: 'ArrowRight' })).toBe(true);
    expect(j).not.toHaveBeenCalled();
    expect(arrow).not.toHaveBeenCalled();
  });

  it('fires inside a region marked not editable', () => {
    const { j } = setup();
    const island = focused(
      '<div contenteditable><span contenteditable="false" tabindex="0">x</span></div>',
      'span',
    );
    fireEvent.keyDown(island, { key: 'j' });
    expect(j).toHaveBeenCalledOnce();
  });

  it('leaves a focused range input its own keys and fires the rest', () => {
    const { j, arrow } = setup();
    const slider = focused('<input type="range">');
    const moves = [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'PageUp',
      'PageDown',
    ];
    for (const key of moves) {
      // Not cancelled, so the browser still moves the slider.
      expect(fireEvent.keyDown(slider, { key })).toBe(true);
    }
    expect(arrow).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(slider, { key: 'j' })).toBe(false);
    expect(j).toHaveBeenCalledOnce();
  });
});
