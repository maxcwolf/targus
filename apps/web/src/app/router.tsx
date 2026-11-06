import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { BuildPage } from '../features/build/BuildPage.js';
import { validateFilterSearch } from '../features/build/filters.js';
import { NotFound } from '../features/errors/ErrorView.js';
import { LibraryPage } from '../features/library/LibraryPage.js';
import { validateLibrarySearch } from '../features/library/stories.js';
import { BuildsPage } from '../features/projects/BuildsPage.js';
import { ProjectsPage } from '../features/projects/ProjectsPage.js';
import { SnapshotPage } from '../features/snapshot/SnapshotPage.js';
import { RootLayout } from './RootLayout.js';

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

/** The app's router. Tests pass a memory history; the browser uses the default. */
export function createAppRouter(history?: RouterHistory) {
  return history ? createRouter({ routeTree, history }) : createRouter({ routeTree });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
