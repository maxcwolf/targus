import { describe, expect, it } from 'vitest';

import { isTargusError, TargusError, targusErrorCodes } from './errors.ts';

describe('TargusError', () => {
  it('carries its code, message and cause', () => {
    const cause = new Error('disk full');
    const error = new TargusError('conflict', 'build already exists', { cause });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TargusError');
    expect(error.code).toBe('conflict');
    expect(error.message).toBe('build already exists');
    expect(error.cause).toBe(cause);
  });

  it('is recognised by isTargusError and plain errors are not', () => {
    expect(isTargusError(new TargusError('not_found', 'missing'))).toBe(true);
    expect(isTargusError(new Error('plain'))).toBe(false);
    expect(isTargusError('not_found')).toBe(false);
  });

  it('lists each code once', () => {
    expect(new Set(targusErrorCodes).size).toBe(targusErrorCodes.length);
  });
});
