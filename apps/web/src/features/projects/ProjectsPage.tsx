import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { Skeleton } from '../../components/Skeleton.js';
import { ErrorView } from '../errors/ErrorView.js';
import { useProjects } from './useProjects.js';

/** `/`: every project the reviewer can see. Never auto-redirects, even with one project. */
export function ProjectsPage(): ReactElement | null {
  const projects = useProjects();
  if (projects.isPending) return <Skeleton label="Loading projects…" rows={3} />;
  if (projects.isError) return <ErrorView error={projects.error} />;

  const list = projects.data.projects;
  return (
    <section>
      <h1>Projects</h1>
      {list.length === 0 ? (
        <p className="muted">No projects yet. A maintainer creates them with the admin API.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Repository</th>
              <th>Org</th>
            </tr>
          </thead>
          <tbody>
            {list.map((project) => (
              <tr key={project.id} className="row-hover">
                <td>
                  <Link to="/projects/$projectId" params={{ projectId: project.id }}>
                    {project.name}
                  </Link>
                </td>
                <td>{project.repo}</td>
                <td>{project.githubOrg}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
