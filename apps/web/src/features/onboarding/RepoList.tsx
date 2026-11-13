import { useQuery } from '@tanstack/react-query';
import type { InstallationRepo } from '@targus/core/browser';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { listInstallationRepos, queryKeys } from '../../api-client/index.ts';
import { Skeleton } from '../../components/Skeleton.tsx';
import { ErrorView } from '../errors/index.ts';

export interface RepoListProps {
  readonly installationId: number;
  /** The repository being created right now, or null. */
  readonly creating: string | null;
  /** Why the last create failed, or null. */
  readonly error: Error | null;
  readonly onCreate: (repo: string) => void;
}

interface RepoRowProps extends Pick<RepoListProps, 'creating' | 'onCreate'> {
  readonly repo: InstallationRepo;
}

function RepoRow({ repo, creating, onCreate }: RepoRowProps): ReactElement {
  return (
    <li className="repo-row">
      <span className="mono">{repo.repo}</span>
      <span className="lighter">{repo.defaultBranch}</span>
      {repo.projectId === null ? (
        <button
          type="button"
          className="button small primary"
          disabled={creating !== null}
          aria-label={`Create project for ${repo.repo}`}
          onClick={() => {
            onCreate(repo.repo);
          }}
        >
          {creating === repo.repo ? 'Creating…' : 'Create project'}
        </button>
      ) : (
        <Link
          to="/projects/$projectId"
          params={{ projectId: repo.projectId }}
          className="button small"
          aria-label={`Open the project for ${repo.repo}`}
        >
          Open project
        </Link>
      )}
    </li>
  );
}

/** Step 2: the repositories the installation can see, each with a create or open button. */
export function RepoList(props: RepoListProps): ReactElement {
  const { installationId, creating, error, onCreate } = props;
  const repos = useQuery({
    queryKey: queryKeys.installationRepos(installationId),
    queryFn: () => listInstallationRepos(installationId),
  });
  return (
    <section className="card onboarding-step" aria-labelledby="onboarding-repo">
      <h2 id="onboarding-repo">2. Repository</h2>
      {repos.isPending ? <Skeleton label="Loading repositories…" rows={3} /> : null}
      {repos.isLoadingError ? <ErrorView error={repos.error} /> : null}
      {repos.data === undefined ? null : (
        <>
          <p className="muted">
            Repositories the GitHub App can see on <strong>{repos.data.account}</strong>.
          </p>
          {error === null ? null : (
            <p role="alert" className="notice notice-error">
              {error.message}
            </p>
          )}
          {repos.data.repos.length === 0 ? (
            <p className="muted">
              None yet. Give the App access to a repository in its GitHub settings, then reload.
            </p>
          ) : (
            <ul className="repo-list">
              {repos.data.repos.map((repo) => (
                <RepoRow key={repo.repo} repo={repo} creating={creating} onCreate={onCreate} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
