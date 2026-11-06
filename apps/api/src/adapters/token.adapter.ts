import { sha256Hex } from '../lib/sha256.ts';

/** Project and admin bearer tokens. Only the SHA-256 of a project token is stored. */
export interface Tokens {
  /** A new 48-character url-safe token (36 random bytes, base64url). */
  generate(): string;
  /** Lowercase hex SHA-256 of the token. */
  hash(token: string): Promise<string>;
  /** Compare two secrets in time that does not depend on where they differ. */
  equals(presented: string, expected: string): Promise<boolean>;
}

function base64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** XOR-fold two equal-length strings, so the comparison never short-circuits. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

export const webCryptoTokens: Tokens = {
  generate: () => base64Url(crypto.getRandomValues(new Uint8Array(36))),
  hash: (token) => sha256Hex(token),
  // Hashing first makes both sides the same length, so length leaks nothing either.
  equals: async (presented, expected) =>
    constantTimeEqual(await sha256Hex(presented), await sha256Hex(expected)),
};
