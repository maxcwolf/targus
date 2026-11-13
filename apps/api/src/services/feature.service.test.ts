import { defaultFeatureFlags } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { testConfig } from '../../test/support/in-memory.ts';
import { featureFlags, requireFeature } from './feature.service.ts';

describe('feature flags', () => {
  it('reports the configured flags and lets a feature that is on through', () => {
    const deps = { config: testConfig };

    expect(featureFlags(deps)).toEqual(defaultFeatureFlags());
    expect(() => {
      requireFeature(deps, 'library');
    }).not.toThrow();
  });

  it('answers not_found for a feature that is off', () => {
    const deps = { config: { ...testConfig, features: { library: false } } };

    expect(() => {
      requireFeature(deps, 'library');
    }).toThrow(expect.objectContaining({ code: 'not_found' }) as Error);
    expect(() => {
      requireFeature(deps, 'library');
    }).toThrow('the library feature is turned off on this server');
  });
});
