import { describe, expect, it } from 'vitest';

import type { ProjectConfig } from '../project-config.ts';
import { resolveCaptureTarget, resolveTargets } from './run-targets.ts';

const both: ProjectConfig = {
  platforms: {
    ios: { app: '/repo/App.app', udid: 'CFG', appearance: 'dark', deviceName: 'iPhone 16' },
    web: { storybook: '/repo/storybook-static', viewport: { width: 800, height: 600 } },
  },
};

describe('resolveTargets', () => {
  it('keeps the flag-only iOS run as it was', () => {
    expect(resolveTargets({ udid: 'SIM', app: 'A.app' }, null)).toEqual([
      { kind: 'ios', udid: 'SIM', app: 'A.app', appearance: 'light' },
    ]);
    expect(() => resolveTargets({ udid: 'SIM' }, null)).toThrow(
      'pass --udid and --app, or --from-capture <dir>',
    );
  });

  it('runs every configured platform, flags over the file', () => {
    expect(resolveTargets({ udid: 'SIM', pixelRatio: 2 }, both)).toEqual([
      {
        kind: 'ios',
        udid: 'SIM',
        app: '/repo/App.app',
        appearance: 'dark',
        deviceName: 'iPhone 16',
      },
      {
        kind: 'web',
        storybook: '/repo/storybook-static',
        viewport: { width: 800, height: 600 },
        pixelRatio: 2,
      },
    ]);
  });

  it('picks platforms with --platform and applies the web defaults', () => {
    expect(
      resolveTargets({ platforms: ['web'], storybook: 'sb', deviceName: 'chromium' }, null),
    ).toEqual([
      {
        kind: 'web',
        storybook: 'sb',
        viewport: { width: 1200, height: 900 },
        pixelRatio: 1,
        deviceName: 'chromium',
      },
    ]);
    expect(resolveTargets({ platforms: ['ios'], bundleId: 'co.x' }, both)).toEqual([
      expect.objectContaining({ kind: 'ios', bundleId: 'co.x' }),
    ]);
  });
});

describe('resolveTargets refusals', () => {
  it('needs a Storybook for web', () => {
    expect(() => resolveTargets({ platforms: ['web'] }, null)).toThrow(
      'pass --storybook <dir or url> for web, or set platforms.web.storybook in the targus config',
    );
  });

  it('refuses one --device-name for several platforms', () => {
    expect(() => resolveTargets({ deviceName: 'X' }, both)).toThrow(
      /--device-name names one device/,
    );
  });

  it('loads one capture directory, remembering the platform asked for', () => {
    expect(resolveTargets({ fromCapture: 'cap', deviceName: 'D' }, both)).toEqual([
      { kind: 'dir', dir: 'cap', deviceName: 'D' },
    ]);
    expect(resolveTargets({ fromCapture: 'cap', platforms: ['web'] }, null)).toEqual([
      { kind: 'dir', dir: 'cap', platform: 'web' },
    ]);
    expect(() => resolveTargets({ fromCapture: 'cap', platforms: ['ios', 'web'] }, null)).toThrow(
      '--from-capture loads one capture: pass one --platform',
    );
  });
});

describe('resolveCaptureTarget', () => {
  it('captures the one platform asked for or configured', () => {
    expect(resolveCaptureTarget({ udid: 'SIM', app: 'A.app' }, null)).toMatchObject({
      kind: 'ios',
    });
    expect(resolveCaptureTarget({ platforms: ['web'] }, both)).toMatchObject({ kind: 'web' });
    expect(resolveCaptureTarget({}, { platforms: { web: { storybook: 'sb' } } })).toMatchObject({
      kind: 'web',
      storybook: 'sb',
    });
  });

  it('needs --platform when the config names two platforms', () => {
    expect(() => resolveCaptureTarget({}, both)).toThrow(
      '`targus capture` captures one platform: pass --platform ios or --platform web',
    );
  });
});
