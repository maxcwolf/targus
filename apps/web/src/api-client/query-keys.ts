/** Every TanStack Query key in the app, so invalidation and `setQueryData` agree on them. */
export const queryKeys = {
  me: ['me'],
  projects: ['projects'],
  builds: (projectId: string) => ['projects', projectId, 'builds'],
  library: (projectId: string) => ['projects', projectId, 'library'],
  build: (buildId: string) => ['builds', buildId],
  snapshots: (buildId: string) => ['builds', buildId, 'snapshots'],
} as const;
