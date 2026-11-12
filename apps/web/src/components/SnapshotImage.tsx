import { type CSSProperties, type ReactElement, useState } from 'react';

export interface SnapshotImageProps {
  readonly src: string;
  readonly alt: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  /**
   * Called with `src` and the image's own size in pixels once the browser has decoded it, so a
   * caller can tell what is on screen and lay it out.
   */
  readonly onLoad?: (
    src: string,
    size: { readonly width: number; readonly height: number },
  ) => void;
}

type LoadState = 'loading' | 'loaded' | 'error';

function classes(state: LoadState, className: string | undefined): string {
  const base = state === 'error' ? 'snapshot-image image-error' : `snapshot-image is-${state}`;
  return className ? `${base} ${className}` : base;
}

function errorText(alt: string): string {
  return alt ? `Could not load the ${alt.toLowerCase()} image` : 'Could not load this image';
}

function LoadingImage({ src, alt, className, style, onLoad }: SnapshotImageProps): ReactElement {
  const [state, setState] = useState<LoadState>('loading');
  if (state === 'error') {
    const text = errorText(alt);
    return (
      <span className={classes(state, className)} style={style} role="img" aria-label={text}>
        {text}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={classes(state, className)}
      style={style}
      onLoad={(event) => {
        setState('loaded');
        const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
        onLoad?.(src, { width, height });
      }}
      onError={() => {
        setState('error');
      }}
    />
  );
}

/**
 * One screenshot. Lazy, because a build page can reference many. A new `src` gets a new `<img>`,
 * so the browser never keeps painting the previous picture while the next one downloads; until it
 * has loaded the element is a neutral placeholder, and a picture that fails says so.
 */
export function SnapshotImage(props: SnapshotImageProps): ReactElement {
  return <LoadingImage key={props.src} {...props} />;
}
