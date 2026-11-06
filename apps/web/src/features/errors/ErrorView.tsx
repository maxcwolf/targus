import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { ApiRequestError, isSignedOut } from '../../api-client/index.ts';
import { CrashPanel } from '../../components/CrashPanel.tsx';
import { SignIn } from '../auth/SignIn.tsx';
import { useSessionExpired } from '../auth/useMe.ts';

/** A page-level "this does not exist" message. */
export function NotFound({ message }: { readonly message?: string }): ReactElement {
  return (
    <section className="panel" role="alert">
      <h1>Not found</h1>
      <p>{message ?? 'There is nothing at this address.'}</p>
      <Link to="/">Back to projects</Link>
    </section>
  );
}

function Forbidden({ message }: { readonly message: string }): ReactElement {
  return (
    <section className="panel" role="alert">
      <h1>No access</h1>
      <p>
        {/not a member/i.test(message)
          ? message
          : `You're not a member of this project's org. ${message}`}
      </p>
      <Link to="/">Back to projects</Link>
    </section>
  );
}

/**
 * A page whose query answered 401. While the auth gate shows its "signed out" notice (with the
 * sign-in link) above, this only says why the page is empty; otherwise it is the sign-in panel.
 */
function SignedOut(): ReactElement {
  const expired = useSessionExpired();
  if (!expired) return <SignIn />;
  return (
    <section className="panel" role="alert">
      <h1>Signed out</h1>
      <p>Sign in again to load this page.</p>
    </section>
  );
}

/** Turns a failed query into the right page: sign in, no access, not found, or a generic error. */
export function ErrorView({ error }: { readonly error: Error }): ReactElement {
  if (isSignedOut(error)) return <SignedOut />;
  if (error instanceof ApiRequestError) {
    if (error.status === 403) return <Forbidden message={error.message} />;
    if (error.status === 404) return <NotFound message={error.message} />;
  }
  return (
    <section className="panel" role="alert">
      <h1>Something went wrong</h1>
      <p>{error.message}</p>
    </section>
  );
}

/**
 * The router's error element for every route (`defaultErrorComponent`): a render crash in a
 * page shows this inside the layout instead of the router's bare default.
 */
export function RouteCrash(): ReactElement {
  return (
    <CrashPanel
      onReload={() => {
        globalThis.location.reload();
      }}
    />
  );
}
