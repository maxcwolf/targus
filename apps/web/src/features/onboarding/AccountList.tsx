import type { InstallationSummary } from '@targus/core/browser';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';

export interface AccountListProps {
  readonly accounts: readonly InstallationSummary[];
  /** Where the GitHub App is installed, or null when the server has no App slug configured. */
  readonly installUrl: string | null;
  readonly selected: number | undefined;
}

function InstallLink({ installUrl }: { installUrl: string | null }): ReactElement {
  if (installUrl === null) {
    return (
      <p className="muted">
        To use another account, ask whoever runs this targus server for the link to its GitHub App.
      </p>
    );
  }
  return (
    <p className="muted">
      <a href={installUrl}>Install the targus GitHub App on an account</a>, or add repositories to
      one that has it. GitHub brings you back here afterwards.
    </p>
  );
}

/** Step 1: the accounts the reviewer already has a project under, and the App install link. */
export function AccountList({ accounts, installUrl, selected }: AccountListProps): ReactElement {
  return (
    <section className="card onboarding-step" aria-labelledby="onboarding-account">
      <h2 id="onboarding-account">1. GitHub account</h2>
      {accounts.length === 0 ? null : (
        <ul className="account-list">
          {accounts.map((account) => (
            <li key={account.installationId}>
              <Link
                to="/new"
                search={{ installation: account.installationId }}
                className="button"
                aria-current={account.installationId === selected ? 'true' : undefined}
              >
                {account.account}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <InstallLink installUrl={installUrl} />
    </section>
  );
}
