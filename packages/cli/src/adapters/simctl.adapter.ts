import {
  TargusError,
  type Appearance,
  type DeviceDriver,
  type StatusBarOverrides,
} from '@targus/core';

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ExecError, execFileBuffer, type Exec } from './exec.adapter.ts';
import { parseDeviceList, type ListedDevice } from './simctl-device-list.ts';

const alreadyBooted = 'Unable to boot device in current state: Booted';
const alreadyShutDown = 'Unable to shutdown device in current state: Shutdown';

/**
 * Simulator services whose notifications land on top of the app mid-capture (ADR 0033).
 * `generativeexperiencesd` posts "Ready for Apple Intelligence" whenever Apple Intelligence
 * availability changes, which follows the host Mac and can happen at any point in a run.
 * `followupd` turns that post into a notification and reminds about it every day.
 */
export const noticeServices = ['com.apple.generativeexperiencesd', 'com.apple.followupd'] as const;

/**
 * Runtimes disagree on where the services live: iOS 18 keeps a `system/` disable only until the
 * next boot, and iOS 26 ignores a `user/foreground/` bootout. Both are sent; neither hurts.
 */
const launchdDomains = ['user/foreground', 'system'] as const;

/**
 * The `launchctl bootout` failures that mean nothing was running: 3 (ESRCH, which iOS 18.3 and
 * 26.2 print for a service not loaded in that domain and for a label they do not have) and 113
 * (launchctl's "could not find service"). Any other failure is reported, not ignored.
 */
const nothingToBootOut = /Boot-out failed: (3|113):/;

const seconds = 1000;
const minutes = 60 * seconds;

/**
 * How long each simctl call may run before it is killed. A cold boot, or an install of a large
 * app, takes minutes; everything else answers in seconds unless the simulator is hung.
 */
export const simctlTimeoutsMs = {
  boot: 1 * minutes,
  bootstatus: 5 * minutes,
  install: 3 * minutes,
  terminate: 30 * seconds,
  launch: 1 * minutes,
  status_bar: 30 * seconds,
  ui: 30 * seconds,
  spawn: 30 * seconds,
  io: 30 * seconds,
  list: 30 * seconds,
  shutdown: 1 * minutes,
} as const;

type SimctlCommand = keyof typeof simctlTimeoutsMs;

export interface SimctlDriverOptions {
  readonly udid: string;
  readonly exec?: Exec;
  /** Where per-screenshot temp directories are made; defaults to the OS temp directory. */
  readonly tempRoot?: string;
  /** Whether a host process is alive; defaults to `isProcessAlive`. */
  readonly isAlive?: (pid: number) => boolean;
  /** Where a non-fatal problem is reported; defaults to stderr. */
  readonly warn?: (line: string) => void;
}

/** `simctl launch` prints `<bundle id>: <pid>`. */
const launchedPid = /:\s*(\d+)\s*$/;

type Kill = (pid: number, signal: 0) => void;

/**
 * Whether host process `pid` exists, by sending it signal 0 (nothing is delivered). A simulator
 * app is an ordinary macOS process, so this needs no simctl call (ADR 0021). Only `ESRCH` means
 * gone; `EPERM` means it exists, and any other answer is treated as alive.
 */
export function isProcessAlive(
  pid: number,
  kill: Kill = (target, signal) => {
    process.kill(target, signal);
  },
): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
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
  private readonly isAlive: (pid: number) => boolean;
  private readonly warn: (line: string) => void;
  /** The pid each bundle id was last launched with. */
  private readonly pids = new Map<string, number>();

  constructor({
    udid,
    exec = execFileBuffer,
    tempRoot = tmpdir(),
    isAlive = isProcessAlive,
    warn = (line) => process.stderr.write(`${line}\n`),
  }: SimctlDriverOptions) {
    this.udid = udid;
    this.exec = exec;
    this.tempRoot = tempRoot;
    this.isAlive = isAlive;
    this.warn = warn;
  }

  /**
   * Boot and wait for bootstatus. A simulator's first boot posts the Apple Intelligence notice
   * before bootstatus returns, and SpringBoard shows it once the home screen is up. So a first
   * boot silences the notice services and boots again, which drops the queued banner (ADR 0033).
   * The caller silences again after `boot`, since iOS 18 forgets the `system/` disable on reboot.
   * A booted simulator no longer lists as new, so this cannot be retried: if it fails partway the
   * simulator is shut down, and the next run's boot drops the delivered banner like a reboot.
   */
  async boot(): Promise<void> {
    const firstBoot = await this.neverBooted();
    await this.bootOnce();
    if (!firstBoot) return;
    try {
      await this.silenceSystemNotices();
      await this.shutdown();
    } catch (error) {
      await this.shutdown().catch(() => undefined);
      const retry = `shut it down with \`xcrun simctl shutdown ${this.udid}\` if it is still booted`;
      const what = `the first boot of simulator ${this.udid} did not finish; ${retry}, then run again`;
      throw new TargusError('internal', what, { cause: error });
    }
    await this.bootOnce();
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
    const { stdout } = await this.simctl(['launch', this.udid, bundleId], childEnv);
    const pid = launchedPid.exec(stdout.toString('utf8'))?.[1];
    if (pid === undefined) this.pids.delete(bundleId);
    else this.pids.set(bundleId, Number(pid));
  }

  /** Checks the pid `simctl launch` printed; `true` when no pid is known. */
  isAppRunning(bundleId: string): Promise<boolean> {
    const pid = this.pids.get(bundleId);
    return Promise.resolve(pid === undefined || this.isAlive(pid));
  }

  /**
   * Disable the notice services in the simulator's launchd, then stop the copies already running.
   * A bootout that finds nothing running is expected; another refusal is a warning, since the
   * capture can still be clean; a failed disable or a timeout propagates.
   */
  async silenceSystemNotices(): Promise<void> {
    const targets = noticeServices.flatMap((service) =>
      launchdDomains.map((domain) => `${domain}/${service}`),
    );
    await Promise.all(targets.map((target) => this.launchctl('disable', target)));
    await Promise.all(targets.map((target) => this.bootOut(target)));
  }

  /**
   * `simctl ui appearance` (ADR 0035). It needs a booted simulator and persists across reboots,
   * so it is set on every run rather than trusted from the last one.
   */
  async setAppearance(appearance: Appearance): Promise<void> {
    await this.simctl(['ui', this.udid, 'appearance', appearance]);
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

  /**
   * The simulator's name (e.g. "iPhone 16"), or `null` when simctl does not list the UDID. Output
   * that cannot be read is a plain TargusError from `parseDeviceList`, not a parser dump.
   */
  async deviceName(): Promise<string | null> {
    return (await this.listed())?.name ?? null;
  }

  async shutdown(): Promise<void> {
    await this.tolerate(alreadyShutDown, this.simctl(['shutdown', this.udid]));
  }

  private simctl(
    [command, ...args]: readonly [SimctlCommand, ...string[]],
    env?: Readonly<Record<string, string>>,
  ) {
    const timeoutMs = simctlTimeoutsMs[command];
    return this.exec(
      'xcrun',
      ['simctl', command, ...args],
      env ? { env, timeoutMs } : { timeoutMs },
    );
  }

  private async bootOnce(): Promise<void> {
    await this.tolerate(alreadyBooted, this.simctl(['boot', this.udid]));
    await this.simctl(['bootstatus', this.udid, '-b']);
  }

  /**
   * Whether simctl lists this simulator with no `lastBootedAt`. A list that fails or does not
   * name the UDID answers `false`: the boot that follows reports the real problem.
   */
  private async neverBooted(): Promise<boolean> {
    const device = await this.listed().catch(() => undefined);
    return device !== undefined && device.lastBootedAt === undefined;
  }

  private async listed(): Promise<ListedDevice | undefined> {
    const { stdout } = await this.simctl(['list', 'devices', '--json']);
    return parseDeviceList(stdout.toString('utf8')).find((entry) => entry.udid === this.udid);
  }

  private launchctl(subcommand: 'disable' | 'bootout', target: string) {
    return this.simctl(['spawn', this.udid, 'launchctl', subcommand, target]);
  }

  private async bootOut(target: string): Promise<void> {
    try {
      await this.launchctl('bootout', target);
    } catch (error) {
      if (!(error instanceof ExecError)) throw error;
      if (nothingToBootOut.test(error.stderr)) return;
      const detail = error.stderr.trim() || error.message;
      this.warn(`warning: could not stop ${target}; its notices may reach screenshots: ${detail}`);
    }
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
