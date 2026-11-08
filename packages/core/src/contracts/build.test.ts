import { describe, expect, it } from 'vitest';

import { Appearance, Build } from './index.ts';

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
