import { useEffect } from 'react';

export interface ReviewKeyHandlers {
  readonly next: () => void;
  readonly previous: () => void;
  readonly approve: () => void;
  readonly deny: () => void;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** `j` next, `k` previous, `a` approve, `d` deny; ignored while typing or with a modifier. */
export function useReviewKeys(handlers: ReviewKeyHandlers): void {
  const { next, previous, approve, deny } = handlers;
  useEffect(() => {
    const byKey: Record<string, () => void> = { j: next, k: previous, a: approve, d: deny };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const handler = byKey[event.key];
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [next, previous, approve, deny]);
}
