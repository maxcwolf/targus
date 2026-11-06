import { isTargusError } from '@targus/core';
import { HTTPException } from 'hono/http-exception';

// One JSON line per request (ADR 0020). What goes in a line is fixed here, field by field, so
// nothing reaches the log by accident: no header, cookie, token, session id, body or image
// bytes is ever copied into it. Services add warnings through `ServiceLog`, never free text
// from a request.

/** Who made the request, as far as authentication got. Never the identity itself. */
export type PrincipalKind = 'none' | 'project' | 'reviewer' | 'admin';

/** A value a warning may carry: identifiers and counts, never request data. */
export type LogValue = string | number | boolean | null | readonly string[];

/** Something a use-case noticed that the request line should carry. */
export interface LogWarning {
  readonly event: string;
  readonly [field: string]: LogValue;
}

/** What a failed request logs: the `TargusError` code, or for anything else its message and stack. */
export interface LoggedError {
  readonly code: string;
  readonly message?: string;
  readonly stack?: string;
}

/** The one line a request writes. */
export interface RequestLogEntry {
  readonly level: 'info' | 'warn' | 'error';
  readonly event: 'request';
  readonly requestId: string;
  /** Cloudflare's `cf-ray` request header, when the request came through Cloudflare. */
  readonly cfRay: string | null;
  readonly method: string;
  /** The matched route pattern (`/api/builds/:id`), or null when no route matched. */
  readonly route: string | null;
  readonly status: number;
  readonly durationMs: number;
  readonly principal: PrincipalKind;
  readonly error?: LoggedError;
  readonly warnings?: readonly LogWarning[];
}

/** Where request lines go: `console` on the Worker, an array in tests. */
export interface Logger {
  write(entry: RequestLogEntry): void;
}

/** The part of a request's log a use-case may write to. */
export interface ServiceLog {
  warn(event: string, fields?: Readonly<Record<string, LogValue>>): void;
}

/** How a request ended, as the logging middleware sees it. */
export interface RequestOutcome {
  readonly method: string;
  readonly route: string | null;
  readonly status: number;
  readonly cfRay: string | null;
  readonly finishedAt: Date;
  readonly error: unknown;
}

/** The fields to log for an error the request failed with, or undefined when there was none. */
export function describeError(error: unknown): LoggedError | undefined {
  if (error === undefined) return undefined;
  if (isTargusError(error)) return { code: error.code };
  if (error instanceof HTTPException) return { code: `http_${String(error.status)}` };
  if (error instanceof Error) {
    const { message, stack } = error;
    return stack === undefined
      ? { code: 'internal', message }
      : { code: 'internal', message, stack };
  }
  return { code: 'internal', message: `a non-Error ${typeof error} was thrown` };
}

/**
 * Why a call a use-case carried on past failed, for a warning: the HTTP status of an Octokit
 * error (whose message and request are not copied), else the error's message.
 */
export function failureReason(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    return `github ${String(error.status)}`;
  }
  return error instanceof Error ? error.message : 'unknown error';
}

function levelOf(status: number, warnings: number): RequestLogEntry['level'] {
  if (status >= 500) return 'error';
  return warnings > 0 ? 'warn' : 'info';
}

/** One request's log: its id, who it turned out to be, and what the use-cases noticed. */
export class RequestLog implements ServiceLog {
  private principalKind: PrincipalKind = 'none';
  private readonly warnings: LogWarning[] = [];

  constructor(
    readonly requestId: string,
    private readonly startedAt: Date,
  ) {}

  /** Called by the auth middleware once a credential has been accepted. */
  authenticatedAs(kind: PrincipalKind): void {
    this.principalKind = kind;
  }

  warn(event: string, fields: Readonly<Record<string, LogValue>> = {}): void {
    this.warnings.push({ ...fields, event });
  }

  entry(outcome: RequestOutcome): RequestLogEntry {
    const error = describeError(outcome.error);
    return {
      level: levelOf(outcome.status, this.warnings.length),
      event: 'request',
      requestId: this.requestId,
      cfRay: outcome.cfRay,
      method: outcome.method,
      route: outcome.route,
      status: outcome.status,
      durationMs: outcome.finishedAt.getTime() - this.startedAt.getTime(),
      principal: this.principalKind,
      ...(error && { error }),
      ...(this.warnings.length > 0 && { warnings: [...this.warnings] }),
    };
  }
}
