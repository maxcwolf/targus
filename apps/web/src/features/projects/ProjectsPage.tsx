import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { Skeleton } from '../../components/Skeleton.tsx';
import { ErrorView } from '../errors/index.ts';
import { useProjects } from './useProjects.ts';

/** `/`: every project the reviewer can see, as cards. Never auto-redirects. */
export function ProjectsPage(): ReactElement | null {
  const projects = useProjects();
  if (projects.isPending) return <Skeleton label="Loading projects…" rows={3} />;
  if (projects.isError) return <ErrorView error={projects.error} />;

  const list = projects.data.projects;
  return (
    <section>
      <h1 className="page-title">Projects</h1>
      {list.length === 0 ? (
        <p className="muted">No projects yet. A maintainer creates them with the admin API.</p>
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
