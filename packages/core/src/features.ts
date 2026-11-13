import { z } from 'zod';

/**
 * Every feature that can be turned on or off without a code change (ADR 0048). A feature is
 * listed here from the pull request that starts it until it is either part of every release or
 * removed; the code that serves it asks for it by name, so the compiler finds every use.
 */
export const featureNames = ['library', 'selfServeProjects'] as const;

export type FeatureName = (typeof featureNames)[number];

/** What a flag stands for, and whether it is on when nothing overrides it. */
export interface FeatureDefinition {
  /** One line for the people who decide whether to turn it on. */
  readonly summary: string;
  /**
   * On unless turned off. A feature that is not ready for release starts `false`, so merging it
   * changes nothing for a server that does not ask for it.
   */
  readonly enabledByDefault: boolean;
}

export const featureCatalog: Readonly<Record<FeatureName, FeatureDefinition>> = {
  library: {
    summary: "Browse a project's accepted stories on the web, without opening a build",
    enabledByDefault: true,
  },
  selfServeProjects: {
    summary: 'Org members create projects from the review UI, through the GitHub App (ADR 0049)',
    enabledByDefault: false,
  },
};

/** Whether each feature is on, as the API tells the review UI. Every feature has an entry. */
export const FeatureFlags = z.record(z.enum(featureNames), z.boolean());
export type FeatureFlags = z.infer<typeof FeatureFlags>;

/** The flags of a server that overrides nothing. */
export function defaultFeatureFlags(): FeatureFlags {
  const entries = featureNames.map((name) => [name, featureCatalog[name].enabledByDefault]);
  return FeatureFlags.parse(Object.fromEntries(entries));
}

export type FeatureFlagsResult =
  | { readonly ok: true; readonly flags: FeatureFlags }
  | { readonly ok: false; readonly problem: string };

const settings: Readonly<Record<string, boolean>> = { on: true, off: false };

function isFeatureName(name: string): name is FeatureName {
  return featureNames.some((known) => known === name);
}

/**
 * The flags for an override list such as `library=off, selfServeProjects=on`: the defaults,
 * with each named feature set. Empty text changes nothing. An unknown name or a setting other
 * than `on` or `off` is a problem, not something to skip: a typo must not leave a feature in the
 * state nobody chose. A feature named twice takes its last setting.
 */
export function resolveFeatureFlags(overrides = ''): FeatureFlagsResult {
  const flags = defaultFeatureFlags();
  const entries = overrides
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  for (const entry of entries) {
    const [name = '', setting = '', ...rest] = entry.split('=').map((part) => part.trim());
    const enabled = settings[setting];
    if (rest.length > 0 || enabled === undefined) {
      return { ok: false, problem: `"${entry}" must be <feature>=on or <feature>=off` };
    }
    if (!isFeatureName(name)) {
      const known = featureNames.join(', ');
      return { ok: false, problem: `"${name}" is not a feature (known: ${known})` };
    }
    flags[name] = enabled;
  }
  return { ok: true, flags };
}
