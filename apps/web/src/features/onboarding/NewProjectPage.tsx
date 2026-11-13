import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { createInstallationProject, listInstallations, queryKeys } from '../../api-client/index.ts';
import { Skeleton } from '../../components/Skeleton.tsx';
import { ErrorView } from '../errors/index.ts';
import { AccountList } from './AccountList.tsx';
import { RepoList } from './RepoList.tsx';
import { TokenPanel } from './TokenPanel.tsx';

export interface NewProjectPageProps {
  /** The installation in the URL: set by GitHub after an install, or by choosing an account. */
  readonly installation: number | undefined;
}

/** `/new`: choose a GitHub account, then a repository; the new project's token is shown once. */
export function NewProjectPage({ installation }: NewProjectPageProps): ReactElement {
  const queryClient = useQueryClient();
  const installations = useQuery({
    queryKey: queryKeys.installations,
    queryFn: listInstallations,
  });
  const create = useMutation({
    mutationFn: ({ id, repo }: { id: number; repo: string }) => createInstallationProject(id, repo),
    onSuccess: (_created, { id }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
        queryClient.invalidateQueries({ queryKey: queryKeys.installations }),
        queryClient.invalidateQueries({ queryKey: queryKeys.installationRepos(id) }),
      ]),
  });

  if (create.data !== undefined) return <TokenPanel created={create.data} />;
  if (installations.isPending) return <Skeleton label="Loading GitHub accounts…" rows={3} />;
  if (installations.isLoadingError) return <ErrorView error={installations.error} />;

  const { installations: accounts, installUrl } = installations.data;
  // With one account and nothing chosen, there is nothing to choose.
  const only = accounts.length === 1 ? accounts[0]?.installationId : undefined;
  const selected = installation ?? only;
  return (
    <section className="onboarding">
      <p className="lighter">
        <Link to="/">Projects</Link> / New project
      </p>
      <h1 className="page-title">New project</h1>
      <p className="muted">
        A project is one GitHub repository. targus reports a check on its pull requests, so the
        targus GitHub App has to be installed on the account that owns it.
      </p>
      <AccountList accounts={accounts} installUrl={installUrl} selected={selected} />
      {selected === undefined ? null : (
        <RepoList
          installationId={selected}
          creating={create.isPending ? create.variables.repo : null}
          error={create.error}
          onCreate={(repo) => {
            create.mutate({ id: selected, repo });
          }}
        />
      )}
    </section>
  );
}
