import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { BuildWithSummary, ProjectSummary } from '@targus/core';
import type { ReactElement } from 'react';

import { listBuilds, queryKeys } from '../../api-client/index.js';
import { commitUrl, formatDateTime, pullRequestUrl, shortSha } from '../../components/format.js';
import { Skeleton } from '../../components/Skeleton.js';
import { StatusChip } from '../../components/StatusChip.js';
import { ErrorView, NotFound } from '../errors/ErrorView.js';
import { BuildCounts } from './BuildCounts.js';
import { useProjects } from './useProjects.js';

function BuildRow({
  item,
  repo,
}: {
  readonly item: BuildWithSummary;
  readonly repo: string;
}): ReactElement {
  const { build } = item;
  return (
    <tr className="row-hover">
      <td>
        <Link className="build-link" to="/builds/$buildId" params={{ buildId: build.id }}>
          Build #{build.number}
        </Link>
      </td>
      <td>
        <StatusChip status={item.summary.status} />
      </td>
      <td className="mono">{build.branch}</td>
      <td>
        {build.prNumber === null ? (
          <span className="muted">—</span>
        ) : (
          <a href={pullRequestUrl(repo, build.prNumber)}>#{build.prNumber}</a>
        )}
      </td>
      <td>
        <a className="mono" href={commitUrl(repo, build.sha)}>
          {shortSha(build.sha)}
        </a>
      </td>
      <td>
        <BuildCounts counts={item.counts} />
      </td>
      <td>{formatDateTime(build.createdAt)}</td>
    </tr>
  );
}

function BuildsTable({ project }: { readonly project: ProjectSummary }): ReactElement {
  const builds = useQuery({
    queryKey: queryKeys.builds(project.id),
    queryFn: () => listBuilds(project.id),
  });
  if (builds.isPending) return <Skeleton label="Loading builds…" rows={6} />;
  if (builds.isError) return <ErrorView error={builds.error} />;
  if (builds.data.builds.length === 0) return <p className="muted">No builds yet.</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Build</th>
          <th>Status</th>
          <th>Branch</th>
          <th>PR</th>
          <th>Commit</th>
          <th>Snapshots</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {builds.data.builds.map((item) => (
          <BuildRow key={item.build.id} item={item} repo={project.repo} />
        ))}
      </tbody>
    </table>
  );
}

/** `/projects/$projectId`: the project's builds, newest first. */
export function BuildsPage({ projectId }: { readonly projectId: string }): ReactElement {
  const projects = useProjects();
  if (projects.isPending) return <Skeleton label="Loading…" rows={6} />;
  if (projects.isError) return <ErrorView error={projects.error} />;
  const project = projects.data.projects.find((candidate) => candidate.id === projectId);
  if (!project) return <NotFound message="No project with this id, or you cannot see it." />;
  return (
    <section>
      <p className="breadcrumb">
        <Link to="/">Projects</Link> / {project.name}
      </p>
      <h1>{project.name}</h1>
      <p className="muted">{project.repo}</p>
      <BuildsTable project={project} />
    </section>
  );
}
