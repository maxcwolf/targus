import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { Build, GetLibraryResponse, ProjectSummary } from '@targus/core/browser';
import { type ReactElement, useState } from 'react';

import { getLibrary, queryKeys } from '../../api-client/index.ts';
import { commitUrl, formatDateTime, shortSha, storyLabel } from '../../components/format.ts';
import { Skeleton } from '../../components/Skeleton.tsx';
import { ErrorView, NotFound } from '../errors/index.ts';
import { useProjects } from '../projects/index.ts';
import { LibrarySidebar } from './LibrarySidebar.tsx';
import { matchesQuery, storyKey } from './stories.ts';
import { StoryCanvas } from './StoryCanvas.tsx';
import { StoryGrid } from './StoryGrid.tsx';

export interface LibraryPageProps {
  readonly projectId: string;
  /** `?story=`: the story shown on its own, else the overview of all of them. */
  readonly story: string | undefined;
}

function LibraryHeader(props: {
  readonly project: ProjectSummary;
  readonly build: Build;
  readonly count: number;
}): ReactElement {
  const { project, build, count } = props;
  return (
    <header className="library-header">
      <h1 className="page-title">Library</h1>
      <p className="subline">
        <span>{storyLabel(count)}</span>
        <span className="dot-sep">·</span>
        <Link to="/builds/$buildId" params={{ buildId: build.id }} search={{ filter: 'all' }}>
          Build {build.number}
        </Link>
        <span>on</span>
        <span className="mono">{build.branch}</span>
        <span className="dot-sep">·</span>
        <a className="mono" href={commitUrl(project.repo, build.sha)}>
          {shortSha(build.sha)}
        </a>
        <span className="dot-sep">·</span>
        <span>{formatDateTime(build.createdAt)}</span>
        <span className="dot-sep">·</span>
        <span>{build.device}</span>
      </p>
    </header>
  );
}

function EmptyLibrary({ project }: { readonly project: ProjectSummary }): ReactElement {
  return (
    <section className="library-empty">
      <h1 className="page-title">Library</h1>
      <p className="muted">
        No accepted build on <span className="mono">{project.defaultBranch}</span> yet. Once a build
        on that branch passes or has every change approved, its stories show up here.
      </p>
      <Link to="/projects/$projectId" params={{ projectId: project.id }}>
        Go to builds
      </Link>
    </section>
  );
}

function LibraryContent(props: {
  readonly project: ProjectSummary;
  readonly build: Build;
  readonly stories: GetLibraryResponse['stories'];
  readonly selected: string | undefined;
}): ReactElement {
  const { project, build, stories, selected } = props;
  const [query, setQuery] = useState('');
  const shown = stories.filter((story) => matchesQuery(story, query));
  const current = stories.find((story) => storyKey(story) === selected);
  const main =
    selected === undefined ? (
      <StoryGrid projectId={project.id} stories={shown} />
    ) : current ? (
      <StoryCanvas
        projectId={project.id}
        story={current}
        stories={shown.includes(current) ? shown : stories}
      />
    ) : (
      <NotFound message="The library has no such story." />
    );
  return (
    <div className="snapshot-layout">
      <LibrarySidebar
        projectId={project.id}
        stories={shown}
        currentKey={current ? selected : undefined}
        query={query}
        onQuery={setQuery}
      />
      <section className="library-main">
        <LibraryHeader project={project} build={build} count={stories.length} />
        {main}
      </section>
    </div>
  );
}

/**
 * `/projects/$projectId/library`: every story as it looks on the default branch, the stand-in
 * for Chromatic's published Storybook (an on-device Storybook cannot be hosted on the web, but
 * the accepted capture of each story can be browsed the same way).
 */
export function LibraryPage({ projectId, story }: LibraryPageProps): ReactElement {
  const projects = useProjects();
  const library = useQuery({
    queryKey: queryKeys.library(projectId),
    queryFn: () => getLibrary(projectId),
  });
  if (projects.isPending || library.isPending) {
    return <Skeleton label="Loading library…" variant="viewer" />;
  }
  if (library.isError) return <ErrorView error={library.error} />;
  if (projects.isError) return <ErrorView error={projects.error} />;
  const project = projects.data.projects.find((candidate) => candidate.id === projectId);
  if (!project) return <NotFound message="No project with this id, or you cannot see it." />;
  const { build, stories } = library.data;
  if (build === null) return <EmptyLibrary project={project} />;
  return <LibraryContent project={project} build={build} stories={stories} selected={story} />;
}
