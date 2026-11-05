import { Link, useRouterState } from '@tanstack/react-router';
import type { ProjectSummary } from '@targus/core';
import type { ReactElement } from 'react';

import { GridIcon, ListIcon } from '../../components/icons.js';

/** The thin icon rail on the left: Projects, and the current project's Builds. */
export function AppRail({
  project,
}: {
  readonly project: ProjectSummary | undefined;
}): ReactElement {
  const onHome = useRouterState({ select: (state) => state.location.pathname === '/' });
  return (
    <nav className="rail" aria-label="App">
      <Link to="/" className={onHome ? 'rail-item active' : 'rail-item'}>
        <GridIcon />
        <span className="rail-label">Projects</span>
      </Link>
      {project ? (
        <Link
          to="/projects/$projectId"
          params={{ projectId: project.id }}
          className={onHome ? 'rail-item' : 'rail-item active'}
        >
          <ListIcon />
          <span className="rail-label">Builds</span>
        </Link>
      ) : null}
    </nav>
  );
}
