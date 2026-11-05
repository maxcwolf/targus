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
  /** Override the status bar so captures are deterministic. */
  setStatusBar(overrides: StatusBarOverrides): Promise<void>;
  /** Capture the full screen as PNG bytes at device resolution. */
  screenshot(): Promise<Uint8Array>;
  /** Shut the device down. Safe to call when it is not booted. */
  shutdown(): Promise<void>;
}
