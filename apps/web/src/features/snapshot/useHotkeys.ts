import { useEffect } from 'react';

/** Handlers by `KeyboardEvent.key`, e.g. `{ j: next, ArrowRight: next, Escape: back }`. */
export type Hotkeys = Readonly<Record<string, () => void>>;

/** The keys a focused `<input type="range">` moves by. */
const rangeKeys: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

/** `isContentEditable`, plus the attribute itself for DOMs that lack the property (jsdom). */
function isEditable(target: HTMLElement): boolean {
  if (target.isContentEditable) return true;
  const host = target.closest('[contenteditable]');
  return host !== null && host.getAttribute('contenteditable') !== 'false';
}

/**
 * Whether the focused control should get this key instead of the shortcuts. Text fields, selects
 * and editable regions keep every key. A range input keeps only the keys that move it, so a
 * slider with focus still answers to the arrows while j/k, a/d and the rest work as usual.
 */
function belongsToControl(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (isEditable(target)) return true;
  if (target instanceof HTMLInputElement && target.type === 'range') return rangeKeys.has(key);
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

const noKeys: readonly string[] = [];

/**
 * Single-key shortcuts on the window. Ignored when the focused control owns the key (see
 * `belongsToControl`) and when a modifier is held (so browser shortcuts keep working).
 *
 * A held key repeats its keydown. The keys in `noRepeat` act once per press and ignore the
 * repeats (still claiming them), so holding `a` approves one snapshot, not each one that
 * auto-advance brings up. The other keys keep repeating: holding `j` walks the list.
 */
export function useHotkeys(keys: Hotkeys, noRepeat: readonly string[] = noKeys): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (belongsToControl(event.target, event.key)) return;
      const handler = keys[event.key];
      if (!handler) return;
      event.preventDefault();
      if (event.repeat && noRepeat.includes(event.key)) return;
      handler();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [keys, noRepeat]);
}
