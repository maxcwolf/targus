import type { ReactElement } from 'react';

import { signInUrl } from '../../api-client/index.js';
import { useReturnTo } from './useMe.js';

/**
 * Shown above the page once the session has expired mid-visit. The page stays, so an action
 * that just failed keeps its error; signing in comes back to this same page.
 */
export function SessionExpired(): ReactElement {
  const returnTo = useReturnTo();
  return (
    <div className="notice notice-error session-expired" role="alert">
      <p>
        <strong>You are signed out.</strong> Your session expired, so changes are not saved until
        you sign in again.
      </p>
      <a className="button primary small" href={signInUrl(returnTo)}>
        Sign in again
      </a>
    </div>
  );
}
