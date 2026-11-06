// Public surface of @targus/cli for programmatic use. The `targus` binary is src/bin.ts.
export { debugEnabled, loadConfig, type CliConfig, type ConfigOverrides } from './config.ts';
export { createProgram, type CommandRunners, type ProgramOptions } from './program.ts';
export {
  exitCodeFor,
  failureExitCode,
  notImplementedExitCode,
  unauthorizedExitCode,
} from './errors/exit-codes.ts';
export { describeError, type ErrorReport } from './errors/describe-error.ts';
export { SimctlDriver, type SimctlDriverOptions } from './adapters/simctl.adapter.ts';
export {
  WsStorybookChannel,
  type WsStorybookChannelOptions,
} from './adapters/ws-channel.adapter.ts';
export {
  captureStories,
  type CaptureOptions,
  type CaptureReport,
  type CaptureResult,
  type CaptureStoriesInput,
  type CompareImages,
  type ImageComparison,
} from './capture/capture-stories.ts';
export { CaptureManifest, readCaptureManifest, writeCaptureOutput } from './capture/manifest.ts';
export { runCapture, type CaptureCommandOptions } from './commands/capture.ts';
export { runCompare, type CompareCommandOptions } from './commands/compare.ts';
export type { CaptureComparison } from './compare/compare-captures.ts';
export { runRun, type RunCommandOptions } from './commands/run.ts';
export { TargusApiClient, type TargusApiClientOptions } from './adapters/api-client.adapter.ts';
export { GitCli, type GitMetadata } from './adapters/git.adapter.ts';
export { resolveCiContext, type CiContext, type CiEnv } from './run/ci-context.ts';
export { runBuild, type RunBuildInput, type RunBuildOutput } from './run/run-build.ts';
export type { TargusApi } from './run/targus-api.ts';
export {
  fixtureCaptureReport,
  writeFixtureCapture,
  type FixtureCaptureVariant,
} from './fixtures/fixture-capture.ts';
