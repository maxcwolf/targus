import type { Logger } from '../logging/request-log.ts';

/**
 * `Logger` for the Worker: one JSON line per request on `console`, which Workers Logs
 * (`observability.enabled` in wrangler.jsonc) and `wrangler tail` index by field.
 */
export const consoleLogger: Logger = {
  write(entry) {
    const line = JSON.stringify(entry);
    if (entry.level === 'error') console.error(line);
    else if (entry.level === 'warn') console.warn(line);
    else console.log(line);
  },
};
