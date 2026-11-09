import { z } from 'zod';

/**
 * A device's preferred content size category: the system text size a user picks under
 * Accessibility > Larger Text, by the names `simctl ui content_size` takes (ADR 0042).
 */
export const ContentSize = z.enum([
  'extra-small',
  'small',
  'medium',
  'large',
  'extra-large',
  'extra-extra-large',
  'extra-extra-extra-large',
  'accessibility-medium',
  'accessibility-large',
  'accessibility-extra-large',
  'accessibility-extra-extra-large',
  'accessibility-extra-extra-extra-large',
]);
export type ContentSize = z.infer<typeof ContentSize>;

/** The content size a device has out of the box, and the one a capture pins (ADR 0042). */
export const defaultContentSize: ContentSize = 'large';
