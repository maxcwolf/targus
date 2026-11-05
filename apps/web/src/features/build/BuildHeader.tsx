import { Link } from '@tanstack/react-router';
import type { BuildWithSummary, ProjectSummary } from '@targus/core';
import type { ReactElement } from 'react';

import { commitUrl, pullRequestUrl, shortSha } from '../../components/format.js';
import { StatusChip } from '../../components/StatusChip.js';
import { summaryLine } from './summary.js';

export interface BuildHeaderProps {
  readonly item: BuildWithSummary;
  readonly project: ProjectSummary | undefined;
}

function PullRequest({ repo, prNumber }: { readonly repo: string; readonly prNumber: number }) {
  return <a href={pullRequestUrl(repo, prNumber)}>PR #{prNumber}</a>;
}

/** Project link, build number, status, git refs and the review summary line. */
export function BuildHeader({ item, project }: BuildHeaderProps): ReactElement {
  const { build, summary } = item;
  const repo = project?.repo;
  return (
    <div className="build-header">
      {project ? (
        <p className="breadcrumb">
          <Link to="/projects/$projectId" params={{ projectId: project.id }}>
            {project.name}
          </Link>
        </p>
      ) : null}
      <h1>
        Build #{build.number} <StatusChip status={summary.status} />
      </h1>
      <p className="meta">
        <span className="mono">{build.branch}</span>
        {repo && build.prNumber !== null ? (
          <PullRequest repo={repo} prNumber={build.prNumber} />
        ) : null}
        {repo ? (
          <a className="mono" href={commitUrl(repo, build.sha)}>
            {shortSha(build.sha)}
          </a>
        ) : (
          <span className="mono">{shortSha(build.sha)}</span>
        )}
        <span>{build.device}</span>
      </p>
      <p className="summary-line">{summaryLine(summary)}</p>
    </div>
  );
}
