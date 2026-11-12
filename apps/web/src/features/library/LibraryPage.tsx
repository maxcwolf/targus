import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { Build, GetLibraryResponse, Platform, ProjectSummary } from '@targus/core/browser';
import { type ReactElement, useState } from 'react';

import { getLibrary, queryKeys } from '../../api-client/index.ts';
import {
  commitUrl,
  deviceLabel,
  formatDateTime,
  platformLabel,
  shortSha,
  storyLabel,
} from '../../components/format.ts';
import { Skeleton } from '../../components/Skeleton.tsx';
import { ErrorView, NotFound, RefetchNotice } from '../errors/index.ts';
import { useProjects } from '../projects/index.ts';
import { LibrarySidebar } from './LibrarySidebar.tsx';
import { PlatformSwitch } from './PlatformSwitch.tsx';
import { matchesQuery, storyKey } from './stories.ts';
import { StoryCanvas } from './StoryCanvas.tsx';
import { StoryGrid } from './StoryGrid.tsx';

export interface LibraryPageProps {
  readonly projectId: string;
  /** `?story=`: the story shown on its own, else the overview of all of them. */
  readonly story: string | undefined;
  /** `?platform=`: the platform shown, else the first that has a library (ADR 0036). */
  readonly platform: Platform | undefined;
}

/** What the library pages share: the project, the API's answer and the search params. */
interface LibraryView {
  readonly project: ProjectSummary;
  readonly library: GetLibraryResponse;
  readonly story: string | undefined;
  readonly platform: Platform | undefined;
  readonly refetchError: Error | null;
}

/** The page title, with the platform switch beside it when there is more than one platform. */
function LibraryTitle({ view }: { readonly view: LibraryView }): ReactElement {
  const { platform, platforms } = view.library;
  return (
    <div className="library-title">
      <h1 className="page-title">Library</h1>
      {platform === null ? null : (
        <PlatformSwitch
          projectId={view.project.id}
          platforms={platforms}
          current={platform}
          story={view.story}
        />
      )}
    </div>
  );
}

function LibraryHeader(props: {
  readonly view: LibraryView;
  readonly build: Build;
  readonly count: number;
}): ReactElement {
  const { view, build, count } = props;
  return (
    <header className="library-header">
      <LibraryTitle view={view} />
      <p className="subline">
        <span>{storyLabel(count)}</span>
        <span className="dot-sep">·</span>
        <Link to="/builds/$buildId" params={{ buildId: build.id }} search={{ filter: 'all' }}>
          Build {build.number}
        </Link>
        <span>on</span>
        <span className="mono">{build.branch}</span>
        <span className="dot-sep">·</span>
        <a className="mono" href={commitUrl(view.project.repo, build.sha)}>
          {shortSha(build.sha)}
        </a>
        <span className="dot-sep">·</span>
        <span>{formatDateTime(build.createdAt)}</span>
        <span className="dot-sep">·</span>
        <span>{deviceLabel(build)}</span>
      </p>
    </header>
  );
}

function EmptyLibrary({ view }: { readonly view: LibraryView }): ReactElement {
  const { project, library } = view;
  const which = library.platform === null ? '' : ` ${platformLabel(library.platform)}`;
  return (
    <section className="library-empty">
      <RefetchNotice error={view.refetchError} />
      <LibraryTitle view={view} />
      <p className="muted">
        No accepted{which} build on <span className="mono">{project.defaultBranch}</span> yet. Once
        a build on that branch passes or has every change approved, its stories show up here.
      </p>
      <Link to="/projects/$projectId" params={{ projectId: project.id }}>
        Go to builds
      </Link>
    </section>
  );
}

function LibraryContent({
  view,
  build,
}: {
  readonly view: LibraryView;
  readonly build: Build;
}): ReactElement {
  const { project, platform, story: selected } = view;
  const { stories } = view.library;
  const [query, setQuery] = useState('');
  const shown = stories.filter((story) => matchesQuery(story, query));
  const current = stories.find((story) => storyKey(story) === selected);
  const main =
    selected === undefined ? (
      <StoryGrid projectId={project.id} platform={platform} stories={shown} />
    ) : current ? (
      <StoryCanvas
        projectId={project.id}
        platform={platform}
        shownPlatform={build.platform}
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
        platform={platform}
        stories={shown}
        currentKey={current ? selected : undefined}
        query={query}
        onQuery={setQuery}
      />
      <section className="library-main">
        <RefetchNotice error={view.refetchError} />
        <LibraryHeader view={view} build={build} count={stories.length} />
        {main}
      </section>
    </div>
  );
}

/**
 * `/projects/$projectId/library`: every story as it looks on the default branch, the stand-in
 * for Chromatic's published Storybook (an on-device Storybook cannot be hosted on the web, but
 * the accepted capture of each story can be browsed the same way). One platform at a time.
 */
export function LibraryPage({ projectId, story, platform }: LibraryPageProps): ReactElement {
  const projects = useProjects();
  const library = useQuery({
    queryKey: queryKeys.library(projectId, platform ?? null),
    queryFn: () => getLibrary(projectId, platform),
  });
  if (projects.isPending || library.isPending) {
    return <Skeleton label="Loading library…" variant="viewer" />;
  }
  // Only a failed first load replaces the page; a failed refetch keeps it on screen.
  if (library.isLoadingError) return <ErrorView error={library.error} />;
  if (projects.isLoadingError) return <ErrorView error={projects.error} />;
  const project = projects.data.projects.find((candidate) => candidate.id === projectId);
  if (!project) return <NotFound message="No project with this id, or you cannot see it." />;
  const refetchError = library.error ?? projects.error;
  const view = { project, library: library.data, story, platform, refetchError };
  const { build } = library.data;
  if (build === null) return <EmptyLibrary view={view} />;
  return <LibraryContent view={view} build={build} />;
}
