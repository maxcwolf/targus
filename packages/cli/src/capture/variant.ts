/** The variant of a story captured without modes (plan.md section 6). */
export const defaultVariant = 'default';

/** How a story and variant are named in summaries: the id, then `@` and the mode. */
export function variantLabel(id: string, variant: string): string {
  return variant === defaultVariant ? id : `${id}@${variant}`;
}

/** A label made safe for a file name: mode names may hold spaces or slashes; ids never do. */
export function fileStem(label: string): string {
  return encodeURIComponent(label).replaceAll('%40', '@');
}
