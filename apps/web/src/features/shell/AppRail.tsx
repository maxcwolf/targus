import { Link, useRouterState } from '@tanstack/react-router';
import type { ProjectSummary } from '@targus/core/browser';
import type { ReactElement } from 'react';

import { useFeature } from '../auth/index.ts';
import { GridIcon, LibraryIcon, ListIcon } from '../../components/icons.tsx';

/** The rail section the current path belongs to. Build and snapshot pages count as Builds. */
function railSection(pathname: string): 'projects' | 'builds' | 'library' {
  if (pathname === '/') return 'projects';
  return pathname.endsWith('/library') ? 'library' : 'builds';
}

/** The thin icon rail on the left: Projects, and the current project's Builds and Library. */
export function AppRail({
  project,
}: {
  readonly project: ProjectSummary | undefined;
}): ReactElement {
  const library = useFeature('library');
  const section = useRouterState({ select: (state) => railSection(state.location.pathname) });
  const itemClass = (name: typeof section): string =>
    section === name ? 'rail-item active' : 'rail-item';
  return (
    <nav className="rail" aria-label="App">
      <Link to="/" className={itemClass('projects')}>
        <GridIcon />
        <span className="rail-label">Projects</span>
      </Link>
      {project ? (
        <>
          {/* Exact, or the router would also mark it active on the library below it. */}
          <Link
            to="/projects/$projectId"
            params={{ projectId: project.id }}
            activeOptions={{ exact: true }}
            className={itemClass('builds')}
          >
            <ListIcon />
            <span className="rail-label">Builds</span>
          </Link>
          {library ? (
            <Link
              to="/projects/$projectId/library"
              params={{ projectId: project.id }}
              className={itemClass('library')}
            >
              <LibraryIcon />
              <span className="rail-label">Library</span>
            </Link>
          ) : null}
        </>
      ) : null}
    </nav>
  );
}
