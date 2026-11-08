import { TargusError, type StoryIndexEntry } from '@targus/core';
import { z } from 'zod';

import { summarizeIssues } from '../errors/zod-summary.ts';

/**
 * The parts of a built Storybook's `index.json` (Storybook 7 and later) the web capture reads:
 * every entry with its type. Docs entries are not stories and are left out.
 */
const StorybookIndex = z.object({
  entries: z.record(
    z.string(),
    z.object({
      id: z.string().min(1),
      title: z.string(),
      name: z.string(),
      type: z.string().optional(),
    }),
  ),
});

/** The stories of an `index.json` body, in the order Storybook lists them. */
export function parseStorybookIndex(body: unknown, source: string): readonly StoryIndexEntry[] {
  const parsed = StorybookIndex.safeParse(body);
  if (!parsed.success) {
    throw new TargusError(
      'bad_request',
      `${source} is not a Storybook 7+ index.json:\n${summarizeIssues(parsed.error.issues)}`,
    );
  }
  return Object.values(parsed.data.entries)
    .filter((entry) => entry.type === undefined || entry.type === 'story')
    .map(({ id, title, name }) => ({ id, title, name }));
}

/** `iframe.html` showing one story on its own, as a capture opens it. */
/** A story global as Storybook reads it from the URL: booleans are `!true` and `!false`. */
function globalValue(value: string | number | boolean): string {
  return typeof value === 'boolean' ? `!${String(value)}` : encodeURIComponent(String(value));
}

/** The URL of one story, with `globals` (a mode's) in Storybook's `key:value;…` form. */
export function storyUrl(
  baseUrl: string,
  storyId: string,
  globals: Readonly<Record<string, string | number | boolean>> = {},
): string {
  const url = `${baseUrl}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`;
  const pairs = Object.entries(globals).map(
    ([key, value]) => `${encodeURIComponent(key)}:${globalValue(value)}`,
  );
  return pairs.length === 0 ? url : `${url}&globals=${pairs.join(';')}`;
}
