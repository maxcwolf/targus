import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RequestLogEntry } from '../logging/request-log.ts';
import { consoleLogger } from './console-logger.adapter.ts';

const entry: RequestLogEntry = {
  level: 'info',
  event: 'request',
  requestId: 'req-1',
  cfRay: null,
  method: 'GET',
  route: '/api/health',
  status: 200,
  durationMs: 3,
  principal: 'none',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('consoleLogger', () => {
  it('prints each entry as one JSON line on the console method for its level', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    consoleLogger.write(entry);
    consoleLogger.write({ ...entry, level: 'warn' });
    consoleLogger.write({ ...entry, level: 'error', status: 500 });

    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify(entry));
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({ level: 'warn' });
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({ status: 500 });
  });
});
