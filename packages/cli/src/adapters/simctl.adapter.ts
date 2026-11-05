import type { DeviceDriver, StatusBarOverrides } from '@targus/core';

import { ExecError, execFileBuffer, type Exec } from './exec.adapter.js';

const alreadyBooted = 'Unable to boot device in current state: Booted';
const alreadyShutDown = 'Unable to shutdown device in current state: Shutdown';

export interface SimctlDriverOptions {
  readonly udid: string;
  readonly exec?: Exec;
}

/**
 * `DeviceDriver` for one iOS simulator, driven through `xcrun simctl` (plan.md section 5.1).
 * Thin by design: every method is one or two simctl calls.
 */
export class SimctlDriver implements DeviceDriver {
  readonly udid: string;
  private readonly exec: Exec;

  constructor({ udid, exec = execFileBuffer }: SimctlDriverOptions) {
    this.udid = udid;
    this.exec = exec;
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

  /** `simctl io screenshot -` writes the PNG to stdout, so no temp file is needed. */
  async screenshot(): Promise<Uint8Array> {
    const { stdout } = await this.simctl(['io', this.udid, 'screenshot', '--type=png', '-']);
    return new Uint8Array(stdout.buffer, stdout.byteOffset, stdout.byteLength);
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
