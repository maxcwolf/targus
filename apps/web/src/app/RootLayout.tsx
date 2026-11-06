import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import type { ProjectSummary } from '@targus/core/browser';
import type { ReactElement } from 'react';

import { isSessionExpired, useMe, UserMenu } from '../features/auth/index.ts';
import { AppRail, useProjectContext } from '../features/shell/index.ts';
import { AuthGate } from './AuthGate.tsx';

function TopBar({
  project,
  login,
}: {
  readonly project: ProjectSummary | undefined;
  readonly login: ReactElement | null;
}): ReactElement {
  return (
    <header className="top-bar">
      <div className="top-bar-path">
        <Link to="/" className="wordmark">
          targus
        </Link>
        {project ? (
          <span className="context-path">
            <span>{project.githubOrg}</span>
            <span className="path-sep">/</span>
            <Link to="/projects/$projectId" params={{ projectId: project.id }}>
              {project.name}
            </Link>
          </span>
        ) : null}
      </div>
      {login}
    </header>
  );
}

const wideRoutes = ['/builds/$buildId/snapshots/$snapshotId', '/projects/$projectId/library'];

/** Top bar, icon rail and the auth gate around every page. */
export function RootLayout(): ReactElement {
  const me = useMe();
  const expired = isSessionExpired(me);
  const project = useProjectContext(me.isSuccess);
  // The snapshot page and the library use the whole width for their sidebar and the captures.
  const wide = useRouterState({
    select: (state) =>
      state.matches.some((match) => wideRoutes.some((routeId) => routeId === match.routeId)),
  });
  return (
    <>
      <TopBar
        project={project}
        login={me.data && !expired ? <UserMenu user={me.data.user} /> : null}
      />
      <div className="shell">
        {me.data ? <AppRail project={project} /> : null}
        <main className={wide ? 'page page-wide' : 'page'}>
          <AuthGate>
            <Outlet />
          </AuthGate>
        </main>
      </div>
    </>
  );
}
