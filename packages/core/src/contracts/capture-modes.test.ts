import { describe, expect, it } from 'vitest';

import { Modes, toCaptureModes } from './capture-modes.ts';
import { defaultContentSize } from './content-size.ts';

describe('Modes', () => {
  it('reads globals, viewports and disabled modes', () => {
    const modes = Modes.parse({
      default: { fontScale: 1 },
      'max font scale': { fontScale: 1.5, reduced: true },
      desktop: { viewport: { width: 1280, height: 900 }, theme: 'dark' },
      narrow: { viewport: 390 },
      pixels: { viewport: '600px' },
      off: { disable: true, theme: 'dark' },
    });
    expect(toCaptureModes(modes)).toEqual([
      { name: 'default', globals: { fontScale: 1 }, viewport: null },
      { name: 'max font scale', globals: { fontScale: 1.5, reduced: true }, viewport: null },
      { name: 'desktop', globals: { theme: 'dark' }, viewport: { width: 1280, height: 900 } },
      { name: 'narrow', globals: {}, viewport: { width: 390, height: null } },
      { name: 'pixels', globals: {}, viewport: { width: 600, height: null } },
    ]);
  });

  it('keeps a content size apart from the globals, and refuses an unknown one', () => {
    const modes = Modes.parse({
      'max font scale': { fontScale: 1.5, contentSize: 'accessibility-extra-extra-extra-large' },
      plain: { theme: 'dark' },
    });
    expect(toCaptureModes(modes)).toEqual([
      {
        name: 'max font scale',
        globals: { fontScale: 1.5 },
        viewport: null,
        contentSize: 'accessibility-extra-extra-extra-large',
      },
      { name: 'plain', globals: { theme: 'dark' }, viewport: null },
    ]);
    expect(Modes.safeParse({ big: { contentSize: 'huge' } }).success).toBe(false);
    expect(defaultContentSize).toBe('large');
  });

  it('refuses named viewports, nested globals and bad names', () => {
    expect(Modes.safeParse({ phone: { viewport: 'iphone14' } }).success).toBe(false);
    expect(Modes.safeParse({ dark: { theme: { name: 'dark' } } }).success).toBe(false);
    expect(Modes.safeParse({ '': {} }).success).toBe(false);
    expect(Modes.safeParse({ 'a\nb': {} }).success).toBe(false);
  });
});
