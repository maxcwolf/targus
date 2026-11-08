import { describe, expect, it } from 'vitest';

import { Platform } from './contracts/build.ts';
import { checkRunName, displayPixelRatio } from './platform.ts';

describe('checkRunName', () => {
  it('names the check run after the platform, keeping targus/ios for iOS', () => {
    expect(Platform.options.map(checkRunName)).toEqual([
      'targus/ios',
      'targus/android',
      'targus/web',
    ]);
  });
});

describe('displayPixelRatio', () => {
  it('uses the pixel ratio the build recorded', () => {
    expect(displayPixelRatio({ platform: 'web', pixelRatio: 2 })).toBe(2);
    expect(displayPixelRatio({ platform: 'ios', pixelRatio: 2 })).toBe(2);
  });

  it('assumes 1 for a web build and 3 for a device build that recorded none', () => {
    expect(displayPixelRatio({ platform: 'web', pixelRatio: null })).toBe(1);
    expect(displayPixelRatio({ platform: 'ios', pixelRatio: null })).toBe(3);
    expect(displayPixelRatio({ platform: 'android', pixelRatio: null })).toBe(3);
  });
});
