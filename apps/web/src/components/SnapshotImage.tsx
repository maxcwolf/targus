import type { CSSProperties, ReactElement } from 'react';

export interface SnapshotImageProps {
  readonly src: string;
  readonly alt: string;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** One screenshot. Lazy, because a build page can reference many. */
export function SnapshotImage({ src, alt, className, style }: SnapshotImageProps): ReactElement {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={className ? `snapshot-image ${className}` : 'snapshot-image'}
      style={style}
    />
  );
}
