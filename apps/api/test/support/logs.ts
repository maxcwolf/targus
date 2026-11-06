import { createFakeClock, createFakeIdGenerator, type FakeClock } from '@targus/core';

import type {
  LogValue,
  LogWarning,
  Logger,
  RequestLogEntry,
  ServiceLog,
} from '../../src/logging/request-log.ts';
import type { Observability } from '../../src/middleware/request-log.ts';

/** A `Logger` that keeps every request line, as the JSON string the Worker would print. */
export interface CapturingLogger extends Logger {
  readonly entries: RequestLogEntry[];
  readonly lines: string[];
}

export function createCapturingLogger(): CapturingLogger {
  const entries: RequestLogEntry[] = [];
  const lines: string[] = [];
  return {
    entries,
    lines,
    write(entry) {
      entries.push(entry);
      lines.push(JSON.stringify(entry));
    },
  };
}

/** Fake ids (`req-1`, `req-2`, ...) and a fake clock, with lines kept in `logger`. */
export function fakeObservability(
  logger: Logger = createCapturingLogger(),
): Observability & { readonly clock: FakeClock } {
  return { clock: createFakeClock(), ids: createFakeIdGenerator('req'), logger };
}

/** A `ServiceLog` that keeps what a use-case warned about, for service tests. */
export interface RecordingLog extends ServiceLog {
  readonly warnings: LogWarning[];
}

export function createRecordingLog(): RecordingLog {
  const warnings: LogWarning[] = [];
  return {
    warnings,
    warn(event: string, fields: Readonly<Record<string, LogValue>> = {}) {
      warnings.push({ ...fields, event });
    },
  };
}
