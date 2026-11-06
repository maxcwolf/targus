import type { ReactElement } from 'react';

import { signInUrl } from '../../api-client/index.ts';
import { useReturnTo } from './useMe.ts';

/** Shown instead of any page while there is no session. Returns to the current page after. */
export function SignIn(): ReactElement {
  const returnTo = useReturnTo();
  return (
    <section className="card sign-in">
      <p className="wordmark wordmark-large">targus</p>
      <h1>Sign in to review</h1>
      <p className="muted">
        targus uses your GitHub account to check that you belong to the project&apos;s org.
      </p>
      <a className="button primary large" href={signInUrl(returnTo)}>
        Sign in with GitHub
      </a>
    </section>
  );
}
