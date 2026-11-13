import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { useFeature } from '../features/auth/index.ts';
import { BuildPage, validateFilterSearch } from '../features/build/index.ts';
import { NotFound, RouteCrash } from '../features/errors/index.ts';
import { LibraryPage, validateLibrarySearch } from '../features/library/index.ts';
import {
  NewProjectPage,
  validateNewProjectSearch,
  validateSetupSearch,
} from '../features/onboarding/index.ts';
import { BuildsPage, ProjectsPage } from '../features/projects/index.ts';
import { SnapshotPage } from '../features/snapshot/index.ts';
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

const newProjectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/new',
  validateSearch: validateNewProjectSearch,
  component: function NewProjectRoute(): ReactElement {
    const { installation } = newProjectRoute.useSearch();
    return <NewProjectPage installation={installation} />;
  },
});

// Where GitHub sends someone who has just installed the App (its "Setup URL").
const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  validateSearch: validateSetupSearch,
  beforeLoad: ({ search }) => {
    // TanStack Router redirects by throwing.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: '/new', search: validateNewProjectSearch(search), replace: true });
  },
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
    const { story, platform } = libraryRoute.useSearch();
    // A feature that is off has no page, like any other unknown path (ADR 0048).
    if (!useFeature('library')) return <NotFound />;
    return <LibraryPage projectId={projectId} story={story} platform={platform} />;
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
  newProjectRoute,
  setupRoute,
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
