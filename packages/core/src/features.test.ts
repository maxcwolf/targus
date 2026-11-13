import { describe, expect, it } from 'vitest';

import {
  defaultFeatureFlags,
  featureCatalog,
  FeatureFlags,
  featureNames,
  resolveFeatureFlags,
} from './features.ts';

describe('the feature catalog', () => {
  it('describes every feature and gives each a default', () => {
    expect(Object.keys(featureCatalog).sort()).toEqual([...featureNames].sort());
    for (const name of featureNames) {
      expect(featureCatalog[name].summary).not.toBe('');
      expect(defaultFeatureFlags()[name]).toBe(featureCatalog[name].enabledByDefault);
    }
  });

  it('has a contract that wants every feature and nothing else', () => {
    expect(FeatureFlags.parse(defaultFeatureFlags())).toEqual(defaultFeatureFlags());
    expect(FeatureFlags.safeParse({}).success).toBe(false);
    expect(FeatureFlags.safeParse({ ...defaultFeatureFlags(), other: true }).success).toBe(false);
    expect(FeatureFlags.safeParse({ library: 'on' }).success).toBe(false);
  });
});

describe('resolveFeatureFlags', () => {
  it('is the defaults for no text, empty text and empty entries', () => {
    for (const text of [undefined, '', '  ', ' , ,']) {
      expect(resolveFeatureFlags(text)).toEqual({ ok: true, flags: defaultFeatureFlags() });
    }
  });

  it('sets each named feature, the last setting of one winning', () => {
    expect(resolveFeatureFlags('library=off')).toEqual({ ok: true, flags: { library: false } });
    expect(resolveFeatureFlags(' library = on ,')).toEqual({ ok: true, flags: { library: true } });
    expect(resolveFeatureFlags('library=off,library=on')).toEqual({
      ok: true,
      flags: { library: true },
    });
    // A fresh object each time: one result never changes the defaults.
    expect(defaultFeatureFlags().library).toBe(true);
  });

  it('refuses an unknown feature and a setting that is not on or off', () => {
    expect(resolveFeatureFlags('libary=off')).toEqual({
      ok: false,
      problem: '"libary" is not a feature (known: library)',
    });
    for (const entry of ['library', 'library=true', 'library=', 'library=on=off', '=on=']) {
      expect(resolveFeatureFlags(entry)).toEqual({
        ok: false,
        problem: `"${entry}" must be <feature>=on or <feature>=off`,
      });
    }
    expect(resolveFeatureFlags('=on')).toMatchObject({ ok: false });
  });
});
