import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { BuildPage } from '../features/build/BuildPage.tsx';
import { validateFilterSearch } from '../features/build/filters.ts';
import { NotFound, RouteCrash } from '../features/errors/ErrorView.tsx';
import { LibraryPage } from '../features/library/LibraryPage.tsx';
import { validateLibrarySearch } from '../features/library/stories.ts';
import { BuildsPage } from '../features/projects/BuildsPage.tsx';
import { ProjectsPage } from '../features/projects/ProjectsPage.tsx';
import { SnapshotPage } from '../features/snapshot/SnapshotPage.tsx';
import { RootLayout } from './RootLayout.tsx';

// Route components here only read params and search; the pages live in features/.
const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => <NotFound />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: ProjectsPage,
});

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId',
  component: function ProjectRoute(): ReactElement {
    const { projectId } = projectRoute.useParams();
    return <BuildsPage projectId={projectId} />;
  },
});

const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId/library',
  validateSearch: validateLibrarySearch,
  component: function LibraryRoute(): ReactElement {
    const { projectId } = libraryRoute.useParams();
    const { story } = libraryRoute.useSearch();
    return <LibraryPage projectId={projectId} story={story} />;
  },
});

const buildRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/builds/$buildId',
  validateSearch: validateFilterSearch,
  component: function BuildRoute(): ReactElement {
    const { buildId } = buildRoute.useParams();
    const { filter } = buildRoute.useSearch();
    return <BuildPage buildId={buildId} filter={filter} />;
  },
});

const snapshotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/builds/$buildId/snapshots/$snapshotId',
  validateSearch: validateFilterSearch,
  component: function SnapshotRoute(): ReactElement {
    const { buildId, snapshotId } = snapshotRoute.useParams();
    const { filter } = snapshotRoute.useSearch();
    return <SnapshotPage buildId={buildId} snapshotId={snapshotId} filter={filter} />;
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  projectRoute,
  libraryRoute,
  buildRoute,
  snapshotRoute,
]);

/**
 * The app's router. Tests pass a memory history; the browser uses the default. A route that
 * throws while rendering shows `RouteCrash` in its place; the layout above it stays.
 */
export function createAppRouter(history?: RouterHistory) {
  const options = { routeTree, defaultErrorComponent: RouteCrash };
  return history ? createRouter({ ...options, history }) : createRouter(options);
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
