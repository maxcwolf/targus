import type { Appearance } from '../contracts/build.ts';

/** Status bar values pinned before capture so the clock and signal never cause a diff. */
export interface StatusBarOverrides {
  readonly time: string;
  readonly batteryLevel: number;
  readonly cellularBars: number;
}

/**
 * A device the CLI renders stories on (plan.md section 5.1). v1 has one adapter, `SimctlDriver`
 * in `packages/cli`; an `AdbDriver` lands with Android.
 */
export interface DeviceDriver {
  /** Boot the device and wait until it accepts installs. Idempotent. */
  boot(): Promise<void>;
  /** Install the app bundle at `appPath` (a `.app` directory for iOS). */
  install(appPath: string): Promise<void>;
  /** Launch the installed app with launch-time environment variables. */
  launch(bundleId: string, env: Readonly<Record<string, string>>): Promise<void>;
  /**
   * Whether the process `launch` started for `bundleId` is still alive (ADR 0021). Cheap enough
   * to poll every second. `true` when the driver cannot tell, so an unknown never fails a run.
   */
  isAppRunning(bundleId: string): Promise<boolean>;
  /**
   * Stop the operating system from drawing its own notices over the app, such as the "Ready for
   * Apple Intelligence" banner on iOS simulators (ADR 0033). Called after every `boot`, since a
   * notice can arrive at any point in a run; a device that has none of them is not an error.
   */
  silenceSystemNotices(): Promise<void>;
  /**
   * Put the device in light or dark mode, so an app whose theme follows the system renders the
   * same on every machine (ADR 0034). Called after `boot` and before the app is launched: a
   * launched app starts in the new mode, while a running one cross-fades into it.
   */
  setAppearance(appearance: Appearance): Promise<void>;
  /** Override the status bar so captures are deterministic. */
  setStatusBar(overrides: StatusBarOverrides): Promise<void>;
  /** Capture the full screen as PNG bytes at device resolution. */
  screenshot(): Promise<Uint8Array>;
  /** Shut the device down. Safe to call when it is not booted. */
  shutdown(): Promise<void>;
}
