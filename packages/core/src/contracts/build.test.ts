import { describe, expect, it } from 'vitest';

import { Appearance, Build, Platform } from './index.ts';

const build = {
  id: 'build-1',
  projectId: 'project-1',
  number: 1,
  sha: 'a'.repeat(40),
  branch: 'main',
  prNumber: null,
  mergeBaseSha: null,
  baselineBuildId: null,
  trigger: 'main',
  device: 'iPhone 16',
  appearance: 'light',
  platform: 'ios',
  pixelRatio: 3,
  status: 'pending',
  createdAt: '2026-11-04T10:00:00.000Z',
  completedAt: null,
};

describe('Build checkRunId', () => {
  it('requires a check run id that is a positive integer or null', () => {
    expect(Build.parse({ ...build, checkRunId: 901 }).checkRunId).toBe(901);
    expect(Build.safeParse(build).success).toBe(false);
    expect(Build.safeParse({ ...build, checkRunId: 0 }).success).toBe(false);
  });
});

describe('Build appearance', () => {
  it('is light, dark, or null for a build from a CLI that did not pin it', () => {
    const stored = { ...build, checkRunId: null };

    expect(Build.parse({ ...stored, appearance: null }).appearance).toBeNull();
    expect(Build.parse({ ...stored, appearance: 'dark' }).appearance).toBe('dark');
    expect(Build.safeParse({ ...stored, appearance: undefined }).success).toBe(false);
    expect(Appearance.options).toEqual(['light', 'dark']);
  });
});

describe('Build platform and pixel ratio', () => {
  const stored = { ...build, checkRunId: null };

  it('requires a platform of ios, android or web', () => {
    expect(Platform.options).toEqual(['ios', 'android', 'web']);
    expect(Build.parse({ ...stored, platform: 'web' }).platform).toBe('web');
    expect(Build.safeParse({ ...stored, platform: undefined }).success).toBe(false);
    expect(Build.safeParse({ ...stored, platform: 'macos' }).success).toBe(false);
  });

  it('takes a pixel ratio above 0 and at most 4, or null when the CLI did not report one', () => {
    const ratio = (pixelRatio: unknown) => Build.safeParse({ ...stored, pixelRatio }).success;

    expect([ratio(1), ratio(2.625), ratio(4), ratio(null)]).toEqual([true, true, true, true]);
    expect([ratio(0), ratio(-1), ratio(4.5), ratio(undefined)]).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});
