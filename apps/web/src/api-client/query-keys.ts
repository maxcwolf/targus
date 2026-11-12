import type { Platform } from '@targus/core/browser';

/** Every TanStack Query key in the app, so invalidation and `setQueryData` agree on them. */
export const queryKeys = {
  me: ['me'],
  projects: ['projects'],
  builds: (projectId: string) => ['projects', projectId, 'builds'],
  /** Per platform asked for; `null` is the server's pick (ADR 0036). */
  library: (projectId: string, platform: Platform | null = null) => [
    'projects',
    projectId,
    'library',
    platform,
  ],
  /** Under `builds(projectId)`, so whatever refreshes the project's builds refreshes it too. */
  storyHistory: (projectId: string, storyId: string, variant: string, platform: Platform) => [
    'projects',
    projectId,
    'builds',
    'history',
    platform,
    storyId,
    variant,
  ],
  build: (buildId: string) => ['builds', buildId],
  snapshots: (buildId: string) => ['builds', buildId, 'snapshots'],
} as const;
