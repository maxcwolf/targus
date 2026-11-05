import { useEffect } from 'react';

/** Handlers by `KeyboardEvent.key`, e.g. `{ j: next, ArrowRight: next, Escape: back }`. */
export type Hotkeys = Readonly<Record<string, () => void>>;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Single-key shortcuts on the window. Ignored while an input has focus (so arrow keys still
 * move a range slider) and when a modifier is held (so browser shortcuts keep working).
 */
export function useHotkeys(keys: Hotkeys): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const handler = keys[event.key];
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [keys]);
}
