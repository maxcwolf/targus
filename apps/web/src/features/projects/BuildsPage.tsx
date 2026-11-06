import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { BuildWithSummary, ProjectSummary } from '@targus/core/browser';
import type { ReactElement } from 'react';

import { listBuilds, queryKeys } from '../../api-client/index.ts';
import { commitUrl, formatDateTime, pullRequestUrl, shortSha } from '../../components/format.ts';
import { Skeleton } from '../../components/Skeleton.tsx';
import { StatusChip } from '../../components/StatusChip.tsx';
import { StatusCircle } from '../../components/StatusCircle.tsx';
import { ErrorView, NotFound } from '../errors/index.ts';
import { BuildCounts } from './BuildCounts.tsx';
import { LoadMoreBuilds } from './LoadMoreBuilds.tsx';
import { useProjects } from './useProjects.ts';

function BuildRow({
  item,
  repo,
}: {
  readonly item: BuildWithSummary;
  readonly repo: string;
}): ReactElement {
  const { build } = item;
  return (
    <li className="build-row">
      <StatusCircle status={item.summary.status} size={20} />
      <div className="build-main">
        <div className="build-title">
          <Link
            className="build-link stretched-link"
            to="/builds/$buildId"
            params={{ buildId: build.id }}
          >
            Build {build.number}
          </Link>
          <StatusChip status={item.summary.status} />
        </div>
        <div className="subline">
          <span className="mono">{build.branch}</span>
          <span className="dot-sep">·</span>
          <a className="mono raised" href={commitUrl(repo, build.sha)}>
            {shortSha(build.sha)}
          </a>
          {build.prNumber === null ? null : (
            <>
              <span className="dot-sep">·</span>
              <a className="raised" href={pullRequestUrl(repo, build.prNumber)}>
                PR #{build.prNumber}
              </a>
            </>
          )}
          <span className="dot-sep">·</span>
          <span>{formatDateTime(build.createdAt)}</span>
        </div>
      </div>
      <BuildCounts counts={item.counts} />
    </li>
  );
}

/** The project's builds, a page at a time: the newest page first, older ones on request. */
function BuildsList({ project }: { readonly project: ProjectSummary }): ReactElement {
  const builds = useInfiniteQuery({
    queryKey: queryKeys.builds(project.id),
    queryFn: ({ pageParam }) => listBuilds(project.id, { cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  if (builds.isPending) return <Skeleton label="Loading builds…" rows={6} />;
  // Only a failed first page replaces the list; a failed later page is shown beside it.
  if (builds.isLoadingError) return <ErrorView error={builds.error} />;
  const items = builds.data.pages.flatMap((page) => page.builds);
  if (items.length === 0) return <p className="muted">No builds yet.</p>;
  return (
    <>
      <ul className="card list-card">
        {items.map((item) => (
          <BuildRow key={item.build.id} item={item} repo={project.repo} />
        ))}
      </ul>
      {builds.hasNextPage ? (
        <LoadMoreBuilds
          loading={builds.isFetchingNextPage}
          error={builds.isFetchNextPageError ? builds.error : null}
          onLoadMore={() => void builds.fetchNextPage()}
        />
      ) : null}
    </>
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
      <header className="page-header">
        <h1 className="page-title">{project.name}</h1>
        <p className="mono muted">{project.repo}</p>
      </header>
      <p className="section-label">Builds</p>
      <BuildsList project={project} />
    </section>
  );
}
