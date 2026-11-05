import { type ReactElement, useState } from 'react';

export interface ConfirmButtonProps {
  readonly label: string;
  readonly confirmLabel: string;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly onConfirm: () => void;
}

/** A button that asks for a second, explicit click before it acts (no `window.confirm`). */
export function ConfirmButton({
  label,
  confirmLabel,
  disabled = false,
  busy = false,
  onConfirm,
}: ConfirmButtonProps): ReactElement {
  const [confirming, setConfirming] = useState(false);
  if (!confirming || disabled) {
    return (
      <button
        type="button"
        className="button primary"
        disabled={disabled || busy}
        onClick={() => {
          setConfirming(true);
        }}
      >
        {label}
      </button>
    );
  }
  return (
    <span className="confirm-group">
      <button
        type="button"
        className="button primary"
        disabled={busy}
        onClick={() => {
          setConfirming(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        className="button ghost"
        onClick={() => {
          setConfirming(false);
        }}
      >
        Cancel
      </button>
    </span>
  );
}
