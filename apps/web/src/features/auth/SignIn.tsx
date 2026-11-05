import { useRouterState } from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { signInUrl } from '../../api-client/index.js';

/** Shown instead of any page while there is no session. Returns to the current page after. */
export function SignIn(): ReactElement {
  const returnTo = useRouterState({ select: (state) => state.location.href });
  return (
    <section className="panel sign-in">
      <h1>Sign in to review</h1>
      <p>targus uses your GitHub account to check that you belong to the project&apos;s org.</p>
      <a className="button primary" href={signInUrl(returnTo)}>
        Sign in with GitHub
      </a>
    </section>
  );
}
