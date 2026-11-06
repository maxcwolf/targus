import type { PointerEvent } from 'react';

/**
 * `onPointerDown` for a range input: when the press ends, wherever the pointer is by then, the
 * input lets go of focus. A slider dragged with the mouse or a finger then leaves the keyboard to
 * the page's shortcuts, while one reached with Tab keeps focus and its arrow keys.
 */
export function releaseFocusOnPointerUp(event: PointerEvent<HTMLElement>): void {
  const element = event.currentTarget;
  const release = (): void => {
    window.removeEventListener('pointerup', release);
    window.removeEventListener('pointercancel', release);
    element.blur();
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
}
