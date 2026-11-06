import { z } from 'zod';

/** The fields Node puts on a failed syscall (`ENOENT`, `ECONNREFUSED`, ...). */
const SystemError = z.object({
  code: z.string(),
  syscall: z.string().optional(),
  path: z.string().optional(),
  address: z.string().optional(),
  port: z.number().optional(),
  hostname: z.string().optional(),
});
type SystemError = z.infer<typeof SystemError>;

/** What went wrong, in words, plus what to do about it when that is knowable. */
export interface Explanation {
  readonly summary: string;
  readonly hint?: string;
  /** Commander error code suffix: `targus.<kind>`. */
  readonly kind: string;
}

const networkReasons: Readonly<Record<string, string>> = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  ENOTFOUND: 'host not found',
  EAI_AGAIN: 'DNS lookup failed',
  ETIMEDOUT: 'connection timed out',
  UND_ERR_CONNECT_TIMEOUT: 'connection timed out',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
};

const fileReasons: Readonly<Record<string, string>> = {
  ENOENT: 'file or directory not found',
  EACCES: 'permission denied',
  EPERM: 'permission denied',
  EISDIR: 'expected a file but found a directory',
  ENOTDIR: 'not a directory',
};

const installHints: Readonly<Record<string, string>> = {
  xcrun: 'install Xcode and its command line tools (xcode-select --install)',
  git: 'install git and make sure it is on PATH',
};

function network(error: SystemError, reason: string): Explanation {
  const target =
    error.hostname ??
    (error.address === undefined ? undefined : `${error.address}:${error.port ?? ''}`);
  return {
    summary: target === undefined ? `${reason} (${error.code})` : `${reason}: ${target}`,
    hint: 'check the API URL (TARGUS_API_URL or --api-url) and that the targus API is reachable',
    kind: 'network',
  };
}

function missingCommand(command: string): Explanation {
  return {
    summary: `command not found: ${command}`,
    hint: installHints[command] ?? `install ${command} or add it to PATH`,
    kind: 'command_not_found',
  };
}

function portInUse(error: SystemError): Explanation {
  return {
    summary: `port ${error.port ?? '(unknown)'} is already in use`,
    hint: 'stop the other process using it (another targus or Storybook server?) or pass --port',
    kind: 'port_in_use',
  };
}

/** Readable wording for a Node system error, or `null` when `value` is not one we know. */
export function explainSystemError(value: unknown): Explanation | null {
  const parsed = SystemError.safeParse(value);
  if (!parsed.success) return null;
  const error = parsed.data;
  if (error.code === 'ENOENT' && error.syscall?.startsWith('spawn') === true) {
    return missingCommand(error.path ?? error.syscall.slice('spawn '.length));
  }
  if (error.code === 'EADDRINUSE') return portInUse(error);
  const networkReason = networkReasons[error.code];
  if (networkReason !== undefined) return network(error, networkReason);
  return fileError(error);
}

function fileError(error: SystemError): Explanation | null {
  const reason = fileReasons[error.code];
  if (reason === undefined) return null;
  return {
    summary: error.path === undefined ? reason : `${reason}: ${error.path}`,
    kind: error.code === 'ENOENT' ? 'file_not_found' : 'file_access',
  };
}
