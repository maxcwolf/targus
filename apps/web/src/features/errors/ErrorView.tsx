import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { ApiRequestError } from '../../api-client/index.js';
import { SignIn } from '../auth/SignIn.js';

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

/** Turns a failed query into the right page: sign in, no access, not found, or a generic error. */
export function ErrorView({ error }: { readonly error: Error }): ReactElement {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return <SignIn />;
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
