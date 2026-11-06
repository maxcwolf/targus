import { TargusError, type DeviceDriver, type StorybookChannel } from '@targus/core';

import type { CaptureProgress } from './capture-stories.ts';

/** Where the simulator writes an app's crash report on the host. */
export const crashReportDir = '~/Library/Logs/DiagnosticReports';

/** How often `whileAppRuns` asks the driver whether the app process is alive. */
export const defaultAppPollMs = 1000;

/** How the app went away: its process ended, or it dropped the channel while still running. */
export type AppGone = 'exited' | 'disconnected';

export interface StoryCount {
  /** Stories finished so far, failed ones included. */
  readonly done: number;
  /** How many stories the capture has, or `null` before the first one finished. */
  readonly total: number | null;
}

function progressText({ done, total }: StoryCount): string {
  return total === null ? 'before any story was captured' : `after ${done} of ${total} stories`;
}

function appGoneMessage(bundleId: string, how: AppGone, count: StoryCount): string {
  const when = progressText(count);
  const discarded = count.done > 0 ? '; the partial capture was discarded' : '';
  if (how === 'disconnected') {
    return `the app ${bundleId} closed its Storybook channel connection ${when}${discarded}`;
  }
  const crash = count.total === null ? 'probably a crash at launch' : 'probably a crash';
  return (
    `the app ${bundleId} exited ${when}, ${crash}: look for its crash report in ` +
    `${crashReportDir}${discarded}`
  );
}

/** The app under test went away during a capture (ADR 0021). Stops the run at once. */
export class AppExitedError extends TargusError {
  override readonly name = 'AppExitedError';

  constructor(
    readonly bundleId: string,
    readonly how: AppGone,
    readonly count: StoryCount,
  ) {
    super('internal', appGoneMessage(bundleId, how, count));
  }
}

export interface AppWatchInput {
  readonly driver: DeviceDriver;
  readonly channel: StorybookChannel;
  readonly bundleId: string;
  readonly pollMs: number;
}

/** What `whileAppRuns` hands the work it watches. */
export interface AppWatch {
  /** Aborted once the watch ends, so work still running in the background can stop. */
  readonly signal: AbortSignal;
  /** Report each finished story, so the error can say how far the capture got. */
  readonly onProgress: (progress: CaptureProgress) => void;
}

/**
 * Run `work` while watching the app, and reject with an `AppExitedError` as soon as its process
 * is gone (polled every `pollMs`) or it drops the channel, instead of letting the work wait out
 * its timeouts. Whichever way it ends, the watch stops and `signal` is aborted.
 */
export async function whileAppRuns<T>(
  input: AppWatchInput,
  work: (watch: AppWatch) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let count: StoryCount = { done: 0, total: null };
  let stopPolling = (): void => undefined;
  const gone = new Promise<never>((_resolve, reject) => {
    const fail = (how: AppGone): void => {
      reject(new AppExitedError(input.bundleId, how, count));
    };
    stopPolling = pollProcess(input, () => {
      fail('exited');
    });
    void input.channel.whenDisconnected().then(async () => {
      const running = await input.driver.isAppRunning(input.bundleId).catch(() => true);
      fail(running ? 'disconnected' : 'exited');
    });
  });
  const onProgress = ({ index, total }: CaptureProgress): void => {
    count = { done: index + 1, total };
  };
  try {
    return await Promise.race([work({ signal: controller.signal, onProgress }), gone]);
  } finally {
    stopPolling();
    controller.abort();
  }
}

/** Call `onExit` once the driver says the app is not running; returns a stop function. */
function pollProcess({ driver, bundleId, pollMs }: AppWatchInput, onExit: () => void) {
  let checking = false;
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    void driver
      .isAppRunning(bundleId)
      .then((running) => {
        if (!running) onExit();
      })
      .catch(() => undefined)
      .finally(() => {
        checking = false;
      });
  }, pollMs);
  return (): void => {
    clearInterval(timer);
  };
}
