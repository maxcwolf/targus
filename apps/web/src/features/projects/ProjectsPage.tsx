import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { Skeleton } from '../../components/Skeleton.tsx';
import { useFeature } from '../auth/index.ts';
import { ErrorView, RefetchNotice } from '../errors/index.ts';
import { useProjects } from './useProjects.ts';

/** `/`: every project the reviewer can see, as cards. Never auto-redirects. */
export function ProjectsPage(): ReactElement | null {
  const projects = useProjects();
  const selfServe = useFeature('selfServeProjects');
  if (projects.isPending) return <Skeleton label="Loading projects…" rows={3} />;
  // Only a failed first load replaces the page; a failed refetch keeps the list on screen.
  if (projects.isLoadingError) return <ErrorView error={projects.error} />;

  const list = projects.data.projects;
  return (
    <section>
      <RefetchNotice error={projects.error} />
      <div className="page-head">
        <h1 className="page-title">Projects</h1>
        {selfServe ? (
          <Link to="/new" className="button primary">
            New project
          </Link>
        ) : null}
      </div>
      {list.length === 0 ? (
        <p className="muted">
          {selfServe
            ? 'No projects yet. Choose New project to add a repository.'
            : 'No projects yet. A maintainer creates them with the admin API.'}
        </p>
      ) : (
        <ul className="project-grid">
          {list.map((project) => (
            <li key={project.id} className="card project-card">
              <Link
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                className="project-name stretched-link"
              >
                {project.name}
              </Link>
              <span className="mono muted">{project.repo}</span>
              <span className="lighter">{project.githubOrg}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
