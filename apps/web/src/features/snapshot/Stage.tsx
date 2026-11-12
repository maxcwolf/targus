import type { CSSProperties, ReactElement, ReactNode } from 'react';

import { SnapshotImage } from '../../components/SnapshotImage.tsx';
import { layerBox, type Size } from './stage-sizes.ts';

export interface StageLayer {
  readonly src: string;
  readonly alt: string;
  /** The image's own size, once known; until then it fills the stage. */
  readonly size: Size | undefined;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * The SVG filters that turn a pixelmatch diff image into an overlay. pixelmatch draws a change in
 * pure red, anti-aliasing it ignored in yellow, and everything else as a faded grey copy of the
 * screen, so `red - green` is 1 on a change and 0 elsewhere.
 *
 * - `targus-diff-key` keeps the changes, in the highlight colour: that difference is the alpha
 *   (times 4, so a one-pixel change survives being scaled down).
 * - `targus-diff-focus` is the reverse, a dark veil with a hole at every change. The veil is
 *   eroded, so each hole grows by a few CSS pixels and shows what is around the change. Its
 *   region is the image's own box: the default region is wider, and the veil would fill it.
 */
export function DiffFilter(): ReactElement {
  return (
    <svg className="diff-filter" width="0" height="0" aria-hidden="true">
      <filter id="targus-diff-key" colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 0  0 0 0 0 0.83  4 -4 0 0 0" />
      </filter>
      <filter
        id="targus-diff-focus"
        colorInterpolationFilters="sRGB"
        x="0"
        y="0"
        width="100%"
        height="100%"
      >
        <feColorMatrix type="matrix" values="0 0 0 0 0.1  0 0 0 0 0.12  0 0 0 0 0.18  -4 4 0 0 1" />
        <feMorphology operator="erode" radius="6" />
      </filter>
    </svg>
  );
}

/**
 * The white card that holds one comparison. Every layer sits top left on a canvas of `canvas`
 * image pixels, each at its own share of it, so images of different sizes keep their shapes and
 * line up at one scale. The CSS sizes the canvas (`--w`, `--h`): actual size, or fitted to the pane.
 */
export function Stage(props: {
  readonly canvas: Size | null;
  readonly layers: readonly StageLayer[];
  readonly onImageLoad: (src: string, size: Size) => void;
  readonly title?: string | undefined;
  readonly children?: ReactNode;
}): ReactElement {
  const { canvas } = props;
  const size = canvas
    ? ({ '--w': String(canvas.width), '--h': String(canvas.height) } as CSSProperties)
    : undefined;
  return (
    <div className="frame" title={props.title}>
      <div className={canvas ? 'stage' : 'stage stage-unsized'} style={size}>
        {props.layers.map((layer) => (
          <SnapshotImage
            key={layer.alt}
            src={layer.src}
            alt={layer.alt}
            className={layer.className ? `layer ${layer.className}` : 'layer'}
            style={{ ...layerBox(layer.size, canvas), ...layer.style }}
            onLoad={props.onImageLoad}
          />
        ))}
        {props.children}
      </div>
    </div>
  );
}
