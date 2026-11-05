// Public surface of @targus/cli for programmatic use. The `targus` binary is src/bin.ts.
export { loadConfig, type CliConfig } from './config.js';
export {
  createProgram,
  exitCodeFor,
  notImplementedExitCode,
  type CommandRunners,
  type ProgramOptions,
} from './program.js';
export { SimctlDriver, type SimctlDriverOptions } from './adapters/simctl.adapter.js';
export {
  WsStorybookChannel,
  type WsStorybookChannelOptions,
} from './adapters/ws-channel.adapter.js';
export {
  captureStories,
  type CaptureOptions,
  type CaptureReport,
  type CaptureResult,
  type CaptureStoriesInput,
  type CompareImages,
  type ImageComparison,
} from './capture/capture-stories.js';
export { CaptureManifest, readCaptureManifest, writeCaptureOutput } from './capture/manifest.js';
export { runCapture, type CaptureCommandOptions } from './commands/capture.js';
export { runCompare, type CompareCommandOptions } from './commands/compare.js';
export type { CaptureComparison } from './compare/compare-captures.js';
export { runRun, type RunCommandOptions } from './commands/run.js';
export { TargusApiClient, type TargusApiClientOptions } from './adapters/api-client.adapter.js';
export { GitCli, type GitMetadata } from './adapters/git.adapter.js';
export { resolveCiContext, type CiContext, type CiEnv } from './run/ci-context.js';
export { runBuild, type RunBuildInput, type RunBuildOutput } from './run/run-build.js';
export type { TargusApi } from './run/targus-api.js';
export { fixtureCaptureReport, writeFixtureCapture } from './fixtures/fixture-capture.js';
