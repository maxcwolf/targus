import { stat } from 'node:fs/promises';
import path from 'node:path';

import { TargusError } from '@targus/core';

import { ExecError, type Exec } from '../adapters/exec.adapter.ts';

/** plutil read the plist but found no bundle id in it. */
class MissingBundleIdError extends Error {
  override readonly name = 'MissingBundleIdError';
}

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
  if (bundleId === '') throw new MissingBundleIdError(`no CFBundleIdentifier in ${plist}`);
  return bundleId;
}

export interface CheckAppBundleOptions {
  readonly exec: Exec;
  /** `--bundle-id`: when given, Info.plist must exist but is not read. */
  readonly bundleId?: string | undefined;
}

const buildHint = 'pass the .app directory built for the iOS simulator';

/** `stat` that answers null for a missing path; any other failure (permissions) is thrown. */
async function entryAt(file: string) {
  try {
    return await stat(file);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/** The plist's bundle id. plutil refusing (no such key, a broken plist) is said plainly. */
async function bundleIdOf(exec: Exec, app: string, appPath: string): Promise<string> {
  try {
    return await readBundleId(exec, appPath);
  } catch (error) {
    // A plutil that is not installed fails with no stderr and keeps its own explanation.
    const refused = error instanceof ExecError && error.stderr.trim() !== '';
    if (!refused && !(error instanceof MissingBundleIdError)) throw error;
    throw new TargusError(
      'bad_request',
      `--app ${app}: its Info.plist has no CFBundleIdentifier: ${buildHint}, or pass --bundle-id`,
      { cause: error },
    );
  }
}

/**
 * Check `--app` before anything slow: the path is a directory with an Info.plist, and the
 * bundle id is `bundleId` or the plist's. Answers the bundle id, so the capture does not read
 * it again.
 */
export async function checkAppBundle(app: string, options: CheckAppBundleOptions): Promise<string> {
  const appPath = path.resolve(app);
  const entry = await entryAt(appPath);
  if (entry === null) {
    throw new TargusError('bad_request', `--app ${app} does not exist: ${buildHint}`);
  }
  if (!entry.isDirectory()) {
    throw new TargusError('bad_request', `--app ${app} is not a directory: ${buildHint}`);
  }
  const plist = await entryAt(path.join(appPath, 'Info.plist'));
  if (plist?.isFile() !== true) {
    throw new TargusError('bad_request', `--app ${app} has no Info.plist: ${buildHint}`);
  }
  return options.bundleId ?? (await bundleIdOf(options.exec, app, appPath));
}
