import { describe, expect, it } from 'vitest';

import { defaultTargusParameters, resolveTargusParameters } from './parameters.ts';

describe('resolveTargusParameters', () => {
  it('applies the defaults when a story sets nothing', () => {
    expect(resolveTargusParameters(undefined)).toEqual({ delay: 300, skip: false });
    expect(resolveTargusParameters({ layout: 'centered' })).toEqual(defaultTargusParameters);
  });

  it('keeps valid values a story sets', () => {
    expect(resolveTargusParameters({ targus: { delay: 1200, skip: true } })).toEqual({
      delay: 1200,
      skip: true,
    });
  });

  it('fills in fields that are missing or malformed', () => {
    expect(resolveTargusParameters({ targus: { delay: -5, skip: 'yes' } })).toEqual({
      delay: 300,
      skip: false,
    });
    expect(resolveTargusParameters({ targus: null })).toEqual(defaultTargusParameters);
  });
});
