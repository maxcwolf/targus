import type { BuildStatus } from '@targus/core';
import type { ReactElement } from 'react';

/** A filled circle in the build status colour (decorative; the status chip carries the text). */
export function StatusCircle({
  status,
  size,
}: {
  readonly status: BuildStatus;
  readonly size: number;
}): ReactElement {
  return (
    <span
      className={`status-circle tone-${status}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

/** A small round initial for a reviewer login, with the login as its tooltip. */
export function Initial({ login }: { readonly login: string }): ReactElement {
  return (
    <span
      className="initial"
      role="img"
      title={`Reviewed by ${login}`}
      aria-label={`Reviewed by ${login}`}
    >
      {login.charAt(0).toUpperCase()}
    </span>
  );
}
