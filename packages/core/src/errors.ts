/**
 * Every error code a targus service may raise. `apps/api` maps each code to exactly one HTTP
 * status in its error middleware, and a unit test there asserts that every code is mapped.
 */
export const targusErrorCodes = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'not_implemented',
  'internal',
] as const;

export type TargusErrorCode = (typeof targusErrorCodes)[number];

/**
 * Base class for typed errors. Services throw this (or a subclass) instead of ad-hoc errors so
 * the transport layer can translate `code` without string matching.
 */
export class TargusError extends Error {
  override readonly name: string = 'TargusError';
  readonly code: TargusErrorCode;

  constructor(code: TargusErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export function isTargusError(value: unknown): value is TargusError {
  return value instanceof TargusError;
}
