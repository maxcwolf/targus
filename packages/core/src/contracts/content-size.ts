import { z } from 'zod';

/**
 * A device's system text size, the one a user picks under Accessibility > Larger Text, by a
 * short name (ADR 0042): the seven standard sizes `xs` to `xxxl`, then the five accessibility
 * sizes `ax1` to `ax5`. A driver maps the name to its platform's own.
 */
export const ContentSize = z.enum([
  'xs',
  's',
  'm',
  'l',
  'xl',
  'xxl',
  'xxxl',
  'ax1',
  'ax2',
  'ax3',
  'ax4',
  'ax5',
]);
export type ContentSize = z.infer<typeof ContentSize>;

/** The content size a device has out of the box, and the one a capture pins (ADR 0042). */
export const defaultContentSize: ContentSize = 'l';

/**
 * The sizes a story is captured at beside its default capture: each once, in the order given,
 * without the default size, which the default capture already is.
 */
export function extraContentSizes(sizes: readonly ContentSize[]): ContentSize[] {
  return [...new Set(sizes)].filter((size) => size !== defaultContentSize);
}
