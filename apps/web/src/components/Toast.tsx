import type { ReactElement } from 'react';

export interface ToastProps {
  readonly message: string | null;
  /** Changes on every new message, so the fade animation restarts. */
  readonly id: number;
}

/** A short-lived confirmation, bottom-center. The parent clears `message` to hide it. */
export function Toast({ message, id }: ToastProps): ReactElement | null {
  if (message === null) return null;
  return (
    <div key={id} role="status" aria-live="polite" className="toast">
      {message}
    </div>
  );
}
