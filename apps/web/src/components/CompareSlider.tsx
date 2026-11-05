import { type ReactElement, useState } from 'react';

import { SnapshotImage } from './SnapshotImage.js';

export interface CompareSliderProps {
  readonly baselineSrc: string;
  readonly currentSrc: string;
}

/**
 * The current image with the baseline laid over it, clipped at the split: left of the line is
 * the baseline, right of it the new capture. An invisible range input covers the whole
 * image, so dragging anywhere and the arrow keys both move the split.
 */
export function CompareSlider({ baselineSrc, currentSrc }: CompareSliderProps): ReactElement {
  const [position, setPosition] = useState(50);
  return (
    <div className="compare-slider">
      <div className="frame">
        <SnapshotImage src={currentSrc} alt="New" />
        <SnapshotImage
          src={baselineSrc}
          alt="Baseline"
          className="overlay"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        />
        <div className="split-line" style={{ left: `${position}%` }} aria-hidden="true">
          <span className="split-grip" />
        </div>
        <input
          type="range"
          className="split-input"
          min={0}
          max={100}
          value={position}
          aria-label="Reveal baseline"
          onChange={(event) => {
            setPosition(Number(event.target.value));
          }}
        />
      </div>
    </div>
  );
}
