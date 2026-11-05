import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { isBlankPng, type Clock, type DeviceDriver, type StorybookChannel } from '@targus/core';

import { execFileBuffer, type Exec } from '../adapters/exec.adapter.js';
import { SimctlDriver } from '../adapters/simctl.adapter.js';
import { systemClock } from '../adapters/system-clock.adapter.js';
import { WsStorybookChannel } from '../adapters/ws-channel.adapter.js';
import { captureStories, type CaptureProgress } from '../capture/capture-stories.js';
import { compareWithCore } from '../capture/compare-images.js';
import { writeCaptureOutput, type CaptureManifest } from '../capture/manifest.js';
import { sha256Hex } from '../capture/png.js';

export interface CaptureCommandOptions {
  readonly udid: string;
  readonly app: string;
  readonly out: string;
  readonly bundleId?: string;
  readonly port: number;
  readonly settle: number;
  readonly stabilityGap: number;
  readonly renderTimeout: number;
  readonly attempts: number;
  readonly connectTimeout: number;
  readonly filter?: string;
  readonly limit?: number;
}

export interface CaptureCommandDeps {
  readonly exec: Exec;
  readonly clock: Clock;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (line: string) => void;
  readonly openChannel: (port: number, connectTimeoutMs: number) => Promise<StorybookChannel>;
  readonly createDriver: (udid: string, exec: Exec) => DeviceDriver;
}

export const defaultCaptureDeps: CaptureCommandDeps = {
  exec: execFileBuffer,
  clock: systemClock,
  sleep: (ms) => delay(ms),
  log: (line) => {
    process.stdout.write(`${line}\n`);
  },
  openChannel: (port, connectTimeoutMs) => WsStorybookChannel.listen({ port, connectTimeoutMs }),
  createDriver: (udid, exec) => new SimctlDriver({ udid, exec }),
};

/** The app's bundle id from its Info.plist, read with `plutil`. */
export async function readBundleId(exec: Exec, appPath: string): Promise<string> {
  const plist = path.join(appPath, 'Info.plist');
  const { stdout } = await exec('plutil', [
    '-extract',
    'CFBundleIdentifier',
    'raw',
    '-o',
    '-',
    plist,
  ]);
  const bundleId = stdout.toString('utf8').trim();
  if (bundleId === '') throw new Error(`no CFBundleIdentifier in ${plist}`);
  return bundleId;
}

function progressLine({ index, total, result }: CaptureProgress): string {
  const position = `${index + 1}/${total} ${result.id}`;
  if (result.error !== null) return `${position} ERROR ${result.error.slice(0, 160)}`;
  const unstable = result.stable ? '' : ` UNSTABLE after ${result.attempts} attempts`;
  return `${position} render=${result.renderMs}ms total=${result.captureMs}ms${unstable}`;
}

/** Human summary printed after a capture: counts, failures, unstable ids and timings. */
export function formatCaptureSummary(manifest: CaptureManifest): string[] {
  const { summary } = manifest;
  const lines = [
    `captured ${summary.captured}/${summary.storyCount} stories in ${(summary.durationMs / 1000).toFixed(1)}s`,
    `failed: ${summary.failed}`,
    `unstable (${summary.unstable.length}): ${summary.unstable.join(', ') || 'none'}`,
  ];
  if (summary.blank.length > 0)
    lines.push(`blank (${summary.blank.length}): ${summary.blank.join(', ')}`);
  if (summary.perStoryMs !== null) {
    const { mean, median, p90, max } = summary.perStoryMs;
    lines.push(`per story: mean ${mean}ms, median ${median}ms, p90 ${p90}ms, max ${max}ms`);
  }
  for (const story of manifest.stories) {
    if (story.error !== null) lines.push(`error ${story.id}: ${story.error}`);
  }
  return lines;
}

async function prepareDevice(
  driver: DeviceDriver,
  appPath: string,
  bundleId: string,
): Promise<void> {
  await driver.boot();
  await driver.setStatusBar({ time: '9:41', batteryLevel: 100, cellularBars: 4 });
  await driver.install(appPath);
  // The app's bundle already enables the channel (EXPO_PUBLIC_TARGUS at bundle time).
  await driver.launch(bundleId, {});
}

/**
 * `targus capture`: boot the simulator, install and launch the app, drive every story over the
 * channel and write `<out>/<storyId>.png` plus `manifest.json`.
 */
export async function runCapture(
  options: CaptureCommandOptions,
  deps: CaptureCommandDeps = defaultCaptureDeps,
): Promise<CaptureManifest> {
  const appPath = path.resolve(options.app);
  const outDir = path.resolve(options.out);
  const bundleId = options.bundleId ?? (await readBundleId(deps.exec, appPath));
  const driver = deps.createDriver(options.udid, deps.exec);
  // Listen before launching so the app finds the server on its first connection attempt.
  const channel = await deps.openChannel(options.port, options.connectTimeout);
  try {
    deps.log(`installing ${appPath} (${bundleId}) on ${options.udid}`);
    await prepareDevice(driver, appPath, bundleId);
    const report = await captureStories({
      channel,
      driver,
      options: {
        settleMs: options.settle,
        stabilityGapMs: options.stabilityGap,
        renderTimeoutMs: options.renderTimeout,
        maxAttempts: options.attempts,
        ...(options.filter === undefined ? {} : { filter: options.filter }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      },
      clock: deps.clock,
      sleep: deps.sleep,
      hash: sha256Hex,
      compareImages: compareWithCore,
      isBlank: isBlankPng,
      onProgress: (progress) => {
        deps.log(progressLine(progress));
      },
    });
    const manifest = await writeCaptureOutput(outDir, report, {
      udid: options.udid,
      bundleId,
      appPath,
      settleMs: options.settle,
      stabilityGapMs: options.stabilityGap,
    });
    for (const line of formatCaptureSummary(manifest)) deps.log(line);
    return manifest;
  } finally {
    await channel.close();
  }
}
