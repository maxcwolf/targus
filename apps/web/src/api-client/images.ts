/** The URL of a content-addressed image; immutable, so the browser caches it forever. */
export function imageUrl(hash: string): string {
  return `/api/images/${encodeURIComponent(hash)}`;
}
