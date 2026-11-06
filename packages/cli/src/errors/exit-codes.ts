import type { TargusErrorCode } from '@targus/core';

/** Exit code for every failure without a code of its own, unexpected errors included. */
export const failureExitCode = 1;

/** Exit code for commands that exist in the CLI surface but are not built yet. */
export const notImplementedExitCode = 2;

/** Exit code when the API rejects the project token (missing, wrong or not allowed). */
export const unauthorizedExitCode = 3;

/** Process exit code for each TargusError code the CLI reports; any other code exits 1. */
const exitCodes: Partial<Record<TargusErrorCode, number>> = {
  not_implemented: notImplementedExitCode,
  unauthorized: unauthorizedExitCode,
  forbidden: unauthorizedExitCode,
};

export function exitCodeFor(code: TargusErrorCode): number {
  return exitCodes[code] ?? failureExitCode;
}
