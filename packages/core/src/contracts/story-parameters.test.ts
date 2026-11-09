import { defaultContentSize } from './content-size.ts';
import { describe, expect, it } from 'vitest';

import {
  maxStoryDelayMs,
  type ParsedStoryParameters,
  parseStoryParameters,
  StoryParametersPayload,
} from './story-parameters.ts';

/** The error message of a rejected value, or null when it was accepted. */
function messageOf(parsed: ParsedStoryParameters): string | null {
  return parsed.ok ? null : parsed.message;
}

describe('parseStoryParameters', () => {
  it('applies the defaults when a story sets nothing', () => {
    const defaults = { ok: true, parameters: { delay: null, skip: false } };
    expect(parseStoryParameters(undefined)).toEqual(defaults);
    expect(parseStoryParameters(null)).toEqual(defaults);
    expect(parseStoryParameters({})).toEqual(defaults);
  });

  it('keeps skip, delay, both, and ignores unknown keys', () => {
    expect(parseStoryParameters({ skip: true })).toEqual({
      ok: true,
      parameters: { delay: null, skip: true },
    });
    expect(parseStoryParameters({ delay: 500, future: 'x' })).toEqual({
      ok: true,
      parameters: { delay: 500, skip: false },
    });
    expect(parseStoryParameters({ delay: maxStoryDelayMs, skip: false })).toEqual({
      ok: true,
      parameters: { delay: maxStoryDelayMs, skip: false },
    });
  });

  it('rejects a delay out of bounds or of the wrong type, naming the field', () => {
    for (const delay of [-1, maxStoryDelayMs + 1, '500', Number.NaN]) {
      expect(messageOf(parseStoryParameters({ delay }))).toMatch(
        /^invalid parameters\.targus: delay: /,
      );
    }
  });

  it('rejects a non-boolean skip and a parameters.targus that is not an object', () => {
    expect(messageOf(parseStoryParameters({ skip: 'yes' }))).toMatch(
      /^invalid parameters\.targus: skip: /,
    );
    expect(messageOf(parseStoryParameters(true))).toBe(
      'invalid parameters.targus: Invalid input: expected object, received boolean',
    );
  });
});

describe('StoryParametersPayload', () => {
  it('needs a story id and passes the raw parameters through', () => {
    expect(StoryParametersPayload.parse({ storyId: 's', targus: { delay: 1 } })).toEqual({
      storyId: 's',
      targus: { delay: 1 },
    });
    expect(StoryParametersPayload.safeParse({ storyId: '' }).success).toBe(false);
  });

  it('accepts a payload without a targus key, as the decorator sends for a story with none', () => {
    expect(StoryParametersPayload.parse({ storyId: 's' })).toEqual({ storyId: 's' });
  });
});

describe('parseStoryParameters with contentSizes', () => {
  it('keeps each size once, in order, without the default size', () => {
    const parsed = parseStoryParameters({ contentSizes: ['ax5', 'l', 'xs', 'ax5'] });

    expect(parsed).toEqual({
      ok: true,
      parameters: { delay: null, skip: false, contentSizes: ['ax5', 'xs'] },
    });
    expect(defaultContentSize).toBe('l');
  });

  it('refuses a size it does not know, by name', () => {
    const parsed = parseStoryParameters({ contentSizes: ['huge'] });

    expect(messageOf(parsed)).toMatch(/contentSizes\.0/);
  });
});
