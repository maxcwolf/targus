import type { DeviceDriver, StatusBarOverrides } from '@targus/core';

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import { ExecError, execFileBuffer, type Exec } from './exec.adapter.js';

const DeviceList = z.object({
  devices: z.record(z.string(), z.array(z.object({ udid: z.string(), name: z.string() }))),
});

const alreadyBooted = 'Unable to boot device in current state: Booted';
const alreadyShutDown = 'Unable to shutdown device in current state: Shutdown';

export interface SimctlDriverOptions {
  readonly udid: string;
  readonly exec?: Exec;
  /** Where per-screenshot temp directories are made; defaults to the OS temp directory. */
  readonly tempRoot?: string;
}

/** simctl exited 0 but left no usable image behind. */
class EmptyScreenshotError extends Error {
  override readonly name = 'EmptyScreenshotError';
}

/**
 * `DeviceDriver` for one iOS simulator, driven through `xcrun simctl` (plan.md section 5.1).
 * Thin by design: every method is one or two simctl calls.
 */
export class SimctlDriver implements DeviceDriver {
  readonly udid: string;
  private readonly exec: Exec;
  private readonly tempRoot: string;

  constructor({ udid, exec = execFileBuffer, tempRoot = tmpdir() }: SimctlDriverOptions) {
    this.udid = udid;
    this.exec = exec;
    this.tempRoot = tempRoot;
  }

  async boot(): Promise<void> {
    await this.tolerate(alreadyBooted, this.simctl(['boot', this.udid]));
    await this.simctl(['bootstatus', this.udid, '-b']);
  }

  async install(appPath: string): Promise<void> {
    await this.simctl(['install', this.udid, appPath]);
  }

  /** Terminate any running copy, then launch with `env` passed as `SIMCTL_CHILD_*`. */
  async launch(bundleId: string, env: Readonly<Record<string, string>>): Promise<void> {
    // terminate fails when the app is not running, which is the common case.
    await this.simctl(['terminate', this.udid, bundleId]).catch(() => undefined);
    const childEnv = Object.fromEntries(
      Object.entries(env).map(([key, value]) => [`SIMCTL_CHILD_${key}`, value]),
    );
    await this.simctl(['launch', this.udid, bundleId], childEnv);
  }

  async setStatusBar({ time, batteryLevel, cellularBars }: StatusBarOverrides): Promise<void> {
    await this.simctl([
      'status_bar',
      this.udid,
      'override',
      '--time',
      time,
      '--batteryState',
      'charged',
      '--batteryLevel',
      String(batteryLevel),
      '--cellularBars',
      String(cellularBars),
      '--dataNetwork',
      'wifi',
      '--wifiMode',
      'active',
      '--wifiBars',
      '3',
    ]);
  }

  /**
   * Capture into a fresh temp directory and read the file back. Not `-` for stdout: Xcode 27.2's
   * simctl writes a file named `-` instead. The directory is removed however the capture ends.
   */
  async screenshot(): Promise<Uint8Array> {
    const dir = await mkdtemp(path.join(this.tempRoot, 'targus-screenshot-'));
    try {
      const file = path.join(dir, 'screenshot.png');
      const { stderr } = await this.simctl(['io', this.udid, 'screenshot', '--type=png', file]);
      return await readScreenshot(file, stderr);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** The simulator's name (e.g. "iPhone 16"), or `null` when simctl does not list the UDID. */
  async deviceName(): Promise<string | null> {
    const { stdout } = await this.simctl(['list', 'devices', '--json']);
    const { devices } = DeviceList.parse(JSON.parse(stdout.toString('utf8')));
    const device = Object.values(devices)
      .flat()
      .find((entry) => entry.udid === this.udid);
    return device?.name ?? null;
  }

  async shutdown(): Promise<void> {
    await this.tolerate(alreadyShutDown, this.simctl(['shutdown', this.udid]));
  }

  private simctl(args: readonly string[], env?: Readonly<Record<string, string>>) {
    return this.exec('xcrun', ['simctl', ...args], env ? { env } : {});
  }

  private async tolerate(message: string, call: Promise<unknown>): Promise<void> {
    try {
      await call;
    } catch (error) {
      if (error instanceof ExecError && error.stderr.includes(message)) return;
      throw error;
    }
  }
}

async function readScreenshot(file: string, stderr: string): Promise<Uint8Array> {
  const bytes = await readFile(file).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  });
  if (bytes === null || bytes.length === 0) {
    const what = bytes === null ? 'no screenshot file' : 'no screenshot (0 bytes)';
    const detail = stderr.trim() === '' ? '' : `: ${stderr.trim()}`;
    throw new EmptyScreenshotError(`simctl exited 0 but wrote ${what}${detail}`);
  }
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
