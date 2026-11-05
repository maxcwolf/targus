import { type ReactElement, useState } from 'react';

import { SnapshotImage } from './SnapshotImage.js';

export interface CompareSliderProps {
  readonly baselineSrc: string;
  readonly currentSrc: string;
}

/**
 * The current image with the baseline laid over it, clipped to the slider position: left of the
 * handle is the baseline, right of it the current capture.
 */
export function CompareSlider({ baselineSrc, currentSrc }: CompareSliderProps): ReactElement {
  const [position, setPosition] = useState(50);
  return (
    <div className="compare-slider">
      <label className="slider-control">
        Baseline ◂ ▸ Current
        <input
          type="range"
          min={0}
          max={100}
          value={position}
          aria-label="Reveal baseline"
          onChange={(event) => {
            setPosition(Number(event.target.value));
          }}
        />
      </label>
      <div className="layered checkerboard">
        <SnapshotImage src={currentSrc} alt="Current" />
        <SnapshotImage
          src={baselineSrc}
          alt="Baseline"
          className="overlay"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        />
      </div>
    </div>
  );
}
