import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import type { ProjectSummary } from '@targus/core';
import type { ReactElement } from 'react';

import { AuthGate } from '../features/auth/AuthGate.js';
import { UserMenu } from '../features/auth/UserMenu.js';
import { useMe } from '../features/auth/useMe.js';
import { AppRail } from '../features/shell/AppRail.js';
import { useProjectContext } from '../features/shell/useProjectContext.js';

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

/** Top bar, icon rail and the auth gate around every page. */
export function RootLayout(): ReactElement {
  const me = useMe();
  const project = useProjectContext(me.isSuccess);
  // The snapshot page uses the whole width for its sidebar and the tall captures.
  const wide = useRouterState({
    select: (state) =>
      state.matches.some((match) => match.routeId === '/builds/$buildId/snapshots/$snapshotId'),
  });
  return (
    <>
      <TopBar project={project} login={me.data ? <UserMenu user={me.data.user} /> : null} />
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
