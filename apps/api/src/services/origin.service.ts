import { TargusError } from '@targus/core';

import type { ServiceDeps } from './deps.js';

/** What a browser says about where a request comes from. */
export interface RequestOrigin {
  readonly method: string;
  /** The `Origin` header, if any. */
  readonly origin: string | undefined;
  /** The `Sec-Fetch-Site` header, if any. */
  readonly secFetchSite: string | undefined;
}

/** Methods that change nothing; every other method is a write. */
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

function refused(reason: string): TargusError {
  return new TargusError('forbidden', `cross-origin request refused: ${reason}`);
}

/**
 * Cookie-authenticated writes must come from the review UI's own origin (ADR 0015). A write
 * needs proof: `Sec-Fetch-Site`, when sent, must be `same-origin`, and `Origin`, when sent, must
 * be the origin of `PUBLIC_URL`; a write that carries neither header is refused, since every
 * current browser sends `Origin` on a POST. Project-token requests never reach this check.
 */
export function assertSameOrigin(deps: Pick<ServiceDeps, 'config'>, request: RequestOrigin): void {
  if (safeMethods.has(request.method.toUpperCase())) return;
  const { origin, secFetchSite } = request;
  if (origin === undefined && secFetchSite === undefined) {
    throw refused('the request has no Origin header');
  }
  if (secFetchSite !== undefined && secFetchSite !== 'same-origin') {
    throw refused(`Sec-Fetch-Site is ${secFetchSite}`);
  }
  if (origin !== undefined && origin !== new URL(deps.config.publicUrl).origin) {
    throw refused(`Origin ${origin} is not the review UI`);
  }
}
