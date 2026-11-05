import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { HealthBadge } from '../features/health/HealthBadge.js';

function RootLayout(): ReactElement {
  return (
    <>
      <header>
        <strong>targus</strong> <HealthBadge />
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}

function HomePage(): ReactElement {
  return <p>Visual review for React Native on-device Storybook.</p>;
}

const rootRoute = createRootRoute({ component: RootLayout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage });
const routeTree = rootRoute.addChildren([indexRoute]);

/** The app's router. Tests pass a memory history; the browser uses the default. */
export function createAppRouter(history?: RouterHistory) {
  return history ? createRouter({ routeTree, history }) : createRouter({ routeTree });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
