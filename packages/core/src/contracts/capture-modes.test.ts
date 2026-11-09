import { describe, expect, it } from 'vitest';

import { Modes, toCaptureModes } from './capture-modes.ts';

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

  it('refuses named viewports, nested globals and bad names', () => {
    expect(Modes.safeParse({ phone: { viewport: 'iphone14' } }).success).toBe(false);
    expect(Modes.safeParse({ dark: { theme: { name: 'dark' } } }).success).toBe(false);
    expect(Modes.safeParse({ '': {} }).success).toBe(false);
    expect(Modes.safeParse({ 'a\nb': {} }).success).toBe(false);
  });
});
