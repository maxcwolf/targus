import type { Appearance } from '../contracts/build.ts';
import type { DeviceDriver, StatusBarOverrides } from './device-driver.ts';

/** One call a `FakeDeviceDriver` received, in the order it was made. */
export type DeviceDriverCall =
  | { readonly method: 'boot' | 'silenceSystemNotices' | 'screenshot' | 'shutdown' }
  | { readonly method: 'install'; readonly appPath: string }
  | {
      readonly method: 'launch';
      readonly bundleId: string;
      readonly env: Readonly<Record<string, string>>;
    }
  | { readonly method: 'setAppearance'; readonly appearance: Appearance }
  | { readonly method: 'setStatusBar'; readonly overrides: StatusBarOverrides };

/** A `DeviceDriver` that records its calls and returns queued screenshots. */
export interface FakeDeviceDriver extends DeviceDriver {
  /** Every call so far, oldest first. */
  readonly calls: readonly DeviceDriverCall[];
  /**
   * Append PNGs for the next `screenshot()` calls, one per call. When the queue runs dry the
   * last screenshot returned is repeated (an empty array if there never was one).
   */
  queueScreenshots(...pngs: readonly Uint8Array[]): void;
  /**
   * Make the launched app exit, as a crash would: `isAppRunning` answers `false` from now on.
   * `isAppRunning` is polled, so its calls are not recorded in `calls`.
   */
  exitApp(): void;
}

export function createFakeDeviceDriver(): FakeDeviceDriver {
  const calls: DeviceDriverCall[] = [];
  const queue: Uint8Array[] = [];
  let last: Uint8Array = new Uint8Array();
  let running = true;

  return {
    calls,
    queueScreenshots: (...pngs) => {
      queue.push(...pngs);
    },
    boot: () => record({ method: 'boot' }),
    install: (appPath) => record({ method: 'install', appPath }),
    exitApp: () => {
      running = false;
    },
    launch: (bundleId, env) => {
      running = true;
      return record({ method: 'launch', bundleId, env: { ...env } });
    },
    isAppRunning: () => Promise.resolve(running),
    silenceSystemNotices: () => record({ method: 'silenceSystemNotices' }),
    setAppearance: (appearance) => record({ method: 'setAppearance', appearance }),
    setStatusBar: (overrides) => record({ method: 'setStatusBar', overrides: { ...overrides } }),
    shutdown: () => record({ method: 'shutdown' }),
    screenshot: () => {
      calls.push({ method: 'screenshot' });
      last = queue.shift() ?? last;
      return Promise.resolve(last);
    },
  };

  function record(call: DeviceDriverCall): Promise<void> {
    calls.push(call);
    return Promise.resolve();
  }
}
