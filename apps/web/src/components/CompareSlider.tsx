import type { ReactElement } from 'react';

import { releaseFocusOnPointerUp } from './releaseFocus.ts';

export interface SplitControlProps {
  /** Where the split is, in percent across the box this control fills. */
  readonly position: number;
  readonly onChange: (position: number) => void;
}

/**
 * The compare slider's handle: a line at the split and an invisible range input over the whole
 * comparison, so dragging anywhere and the arrow keys both move the split. A drag lets go of focus
 * when it ends, so the review shortcuts work straight after it.
 */
export function SplitControl({ position, onChange }: SplitControlProps): ReactElement {
  return (
    <>
      <div className="split-line" style={{ left: `${String(position)}%` }} aria-hidden="true">
        <span className="split-grip" />
      </div>
      <input
        type="range"
        className="split-input"
        min={0}
        max={100}
        value={position}
        aria-label="Reveal baseline"
        onPointerDown={releaseFocusOnPointerUp}
        onChange={(event) => {
          onChange(Number(event.target.value));
        }}
      />
    </>
  );
}
