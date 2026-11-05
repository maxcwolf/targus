import { describe, expect, it } from 'vitest';

import { webCryptoTokens } from './token.adapter.js';

describe('webCryptoTokens', () => {
  it('generates distinct 48-character url-safe tokens', () => {
    const tokens = new Set(Array.from({ length: 20 }, () => webCryptoTokens.generate()));

    expect(tokens.size).toBe(20);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{48}$/);
  });

  it('hashes with sha256 hex', async () => {
    expect(await webCryptoTokens.hash('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('compares secrets', async () => {
    expect(await webCryptoTokens.equals('secret', 'secret')).toBe(true);
    expect(await webCryptoTokens.equals('secret', 'secreT')).toBe(false);
    expect(await webCryptoTokens.equals('short', 'much longer secret')).toBe(false);
  });
});
