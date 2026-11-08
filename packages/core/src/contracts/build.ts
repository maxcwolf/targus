import { z } from 'zod';

/** What started a build: a pull request or a push to the default branch. */
export const BuildTrigger = z.enum(['pr', 'main']);
export type BuildTrigger = z.infer<typeof BuildTrigger>;

/**
 * Lifecycle and review outcome of a build, matching the status chips in plan.md section 5.3.
 * `in_progress` while the CLI is still uploading, `failed` when capture failed.
 */
export const BuildStatus = z.enum([
  'in_progress',
  'pending',
  'accepted',
  'denied',
  'passed',
  'failed',
]);
export type BuildStatus = z.infer<typeof BuildStatus>;

/**
 * Statuses whose images may serve as a baseline: everything a reviewer has signed off
 * (plan.md section 6, rule 1). `resolveBaseline` and the API's SQL baseline query both use it.
 */
export const baselineBuildStatuses = [
  'passed',
  'accepted',
] as const satisfies readonly BuildStatus[];

/**
 * The light or dark mode the device was in when the build was captured (ADR 0035). The CLI pins
 * it before the first story, `light` unless `--appearance` says otherwise.
 */
export const Appearance = z.enum(['light', 'dark']);
export type Appearance = z.infer<typeof Appearance>;

/**
 * What a build was captured on (ADR 0036). Each platform of a project has its own baselines,
 * check run and library. A build opened by a CLI that predates the field is `ios`.
 */
export const Platform = z.enum(['ios', 'android', 'web']);
export type Platform = z.infer<typeof Platform>;

/**
 * Device pixels per point (iOS, Android) or per CSS pixel (web) of a build's captures, which the
 * review UI divides by for its actual-size view (ADR 0036). No device in use goes above 4.
 */
export const PixelRatio = z.number().positive().max(4);

/** A full 40-character git commit sha, lowercase hex. */
export const GitSha = z.string().regex(/^[0-9a-f]{40}$/, 'expected a full 40-character git sha');

/** One CI run of one project, as stored in the `builds` table. */
export const Build = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  number: z.number().int().positive(),
  sha: GitSha,
  branch: z.string().min(1),
  prNumber: z.number().int().positive().nullable(),
  mergeBaseSha: GitSha.nullable(),
  baselineBuildId: z.string().min(1).nullable(),
  trigger: BuildTrigger,
  device: z.string().min(1),
  /** Null for a build opened by a CLI that did not pin the appearance. */
  appearance: Appearance.nullable(),
  platform: Platform,
  /** Null when the CLI did not report it; `displayPixelRatio` then assumes the platform's. */
  pixelRatio: PixelRatio.nullable(),
  status: BuildStatus,
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  /** The build's `targus/<platform>` GitHub check run, or null when none was created. */
  checkRunId: z.number().int().positive().nullable(),
});
export type Build = z.infer<typeof Build>;
