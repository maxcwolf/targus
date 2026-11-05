import type { DeviceDriver, StatusBarOverrides } from './device-driver.js';

/** One call a `FakeDeviceDriver` received, in the order it was made. */
export type DeviceDriverCall =
  | { readonly method: 'boot' | 'screenshot' | 'shutdown' }
  | { readonly method: 'install'; readonly appPath: string }
  | {
      readonly method: 'launch';
      readonly bundleId: string;
      readonly env: Readonly<Record<string, string>>;
    }
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
}

export function createFakeDeviceDriver(): FakeDeviceDriver {
  const calls: DeviceDriverCall[] = [];
  const queue: Uint8Array[] = [];
  let last: Uint8Array = new Uint8Array();

  return {
    calls,
    queueScreenshots: (...pngs) => {
      queue.push(...pngs);
    },
    boot: () => record({ method: 'boot' }),
    install: (appPath) => record({ method: 'install', appPath }),
    launch: (bundleId, env) => record({ method: 'launch', bundleId, env: { ...env } }),
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
