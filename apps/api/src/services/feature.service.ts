import { type FeatureFlags, type FeatureName, TargusError } from '@targus/core';

import type { ServiceDeps } from './deps.ts';

type FeatureDeps = Pick<ServiceDeps, 'config'>;

/** Which features this server has on, for the review UI (ADR 0048). */
export function featureFlags(deps: FeatureDeps): FeatureFlags {
  return deps.config.features;
}

/**
 * Throws `not_found` when `feature` is off: a route of a feature that is off answers as a route
 * that does not exist, so nothing can be built on it by accident.
 */
export function requireFeature(deps: FeatureDeps, feature: FeatureName): void {
  if (deps.config.features[feature]) return;
  throw new TargusError('not_found', `the ${feature} feature is turned off on this server`);
}
