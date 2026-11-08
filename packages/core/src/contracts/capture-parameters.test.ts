import { describe, expect, it } from 'vitest';

import { parseCaptureParameters } from './capture-parameters.ts';
import { maxStoryDelayMs } from './story-parameters.ts';

const defaults = { ok: true, parameters: { delay: null, skip: false } };

describe('parseCaptureParameters', () => {
  it('applies the defaults when a story sets neither', () => {
    expect(parseCaptureParameters({})).toEqual(defaults);
    expect(parseCaptureParameters({ targus: null, chromatic: null })).toEqual(defaults);
  });

  it('prefers parameters.targus over parameters.chromatic', () => {
    expect(
      parseCaptureParameters({ targus: { delay: 200 }, chromatic: { disableSnapshot: true } }),
    ).toEqual({ ok: true, parameters: { delay: 200, skip: false } });
  });

  it('reports an invalid parameters.targus even when chromatic is valid', () => {
    const parsed = parseCaptureParameters({ targus: { delay: -1 }, chromatic: { delay: 5 } });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.message).toMatch(/^invalid parameters\.targus: delay/);
  });

  it('maps disable and disableSnapshot to skip, and keeps delay', () => {
    expect(parseCaptureParameters({ chromatic: { disable: true } })).toEqual({
      ok: true,
      parameters: { delay: null, skip: true },
    });
    expect(parseCaptureParameters({ chromatic: { disableSnapshot: true, delay: 600 } })).toEqual({
      ok: true,
      parameters: { delay: 600, skip: true },
    });
    expect(parseCaptureParameters({ chromatic: { disable: false, delay: 600 } })).toEqual({
      ok: true,
      parameters: { delay: 600, skip: false },
    });
  });

  it('ignores Chromatic keys targus does not use', () => {
    expect(parseCaptureParameters({ chromatic: { modes: { a: {} }, diffThreshold: 0.2 } })).toEqual(
      defaults,
    );
  });

  it('rejects a known Chromatic key with a bad value, naming it', () => {
    for (const chromatic of [{ delay: maxStoryDelayMs + 1 }, { delay: '600' }, { disable: 1 }]) {
      const parsed = parseCaptureParameters({ chromatic });
      expect(parsed.ok ? '' : parsed.message).toMatch(/^invalid parameters\.chromatic: \w+/);
    }
    const root = parseCaptureParameters({ chromatic: 'yes' });
    expect(root.ok ? '' : root.message).toBe(
      'invalid parameters.chromatic: Invalid input: expected object, received string',
    );
  });
});
