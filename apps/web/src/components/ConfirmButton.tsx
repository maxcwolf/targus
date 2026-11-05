import { type ReactElement, useState } from 'react';

export interface ConfirmButtonProps {
  readonly label: string;
  readonly confirmLabel: string;
  /** Tooltip on the first button, for a label too short to explain itself. */
  readonly title?: string;
  /** `secondary` keeps both steps outlined, for a button that sits beside the primary action. */
  readonly variant?: 'primary' | 'secondary';
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly onConfirm: () => void;
}

interface ConfirmStepProps {
  readonly className: string;
  readonly label: string;
  readonly busy: boolean;
  readonly onAnswer: (confirmed: boolean) => void;
}

function ConfirmStep({ className, label, busy, onAnswer }: ConfirmStepProps): ReactElement {
  return (
    <span className="confirm-group">
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => {
          onAnswer(true);
        }}
      >
        {label}
      </button>
      <button
        type="button"
        className="button ghost"
        onClick={() => {
          onAnswer(false);
        }}
      >
        Cancel
      </button>
    </span>
  );
}

/** A button that asks for a second, explicit click before it acts (no `window.confirm`). */
export function ConfirmButton({
  label,
  confirmLabel,
  title,
  variant = 'primary',
  disabled = false,
  busy = false,
  onConfirm,
}: ConfirmButtonProps): ReactElement {
  const [confirming, setConfirming] = useState(false);
  const className = variant === 'primary' ? 'button primary' : 'button';
  if (confirming && !disabled) {
    return (
      <ConfirmStep
        className={className}
        label={confirmLabel}
        busy={busy}
        onAnswer={(confirmed) => {
          setConfirming(false);
          if (confirmed) onConfirm();
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className={className}
      title={title}
      disabled={disabled || busy}
      onClick={() => {
        setConfirming(true);
      }}
    >
      {label}
    </button>
  );
}
