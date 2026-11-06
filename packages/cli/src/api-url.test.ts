import { TargusError } from '@targus/core';
import { describe, expect, it } from 'vitest';

import { parseApiUrl } from './api-url.ts';

function failure(value: string): string {
  try {
    parseApiUrl(value, 'TARGUS_API_URL');
  } catch (error) {
    if (error instanceof TargusError && error.code === 'bad_request') return error.message;
    throw error;
  }
  throw new Error(`expected ${value} to be rejected`);
}

/** The headline of the error, without the hint line every rejection ends with. */
function reason(value: string): string {
  return failure(value).split('\n')[0] ?? '';
}

describe('parseApiUrl accepts', () => {
  it.each([
    ['http://localhost:8787', 'http://localhost:8787'],
    ['https://targus.example.com', 'https://targus.example.com'],
    ['https://targus.example.com/', 'https://targus.example.com'],
    ['  https://Targus.Example.com//  ', 'https://targus.example.com'],
    ['https://targus.example.com:443', 'https://targus.example.com'],
    ['https://example.com/targus', 'https://example.com/targus'],
    ['https://example.com/targus/', 'https://example.com/targus'],
    ['http://127.0.0.1:8787/', 'http://127.0.0.1:8787'],
  ])('%s as %s', (value, normalised) => {
    expect(parseApiUrl(value, '--api-url')).toBe(normalised);
  });
});

describe('parseApiUrl rejects', () => {
  it('names the source, shows the value and gives a good example', () => {
    expect(failure('ftp://targus.example.com')).toBe(
      'TARGUS_API_URL "ftp://targus.example.com" uses ftp:// but only http:// and https:// ' +
        'are supported\n' +
        "  set --api-url or TARGUS_API_URL to the targus API's address, for example " +
        'https://targus.example.com',
    );
  });

  it('names --api-url when the flag is at fault', () => {
    expect(() => parseApiUrl('nope nope', '--api-url')).toThrow(
      /^--api-url "nope nope" is not a URL\n/,
    );
  });

  it.each([
    ['', 'TARGUS_API_URL "" is empty'],
    ['   ', 'TARGUS_API_URL "" is empty'],
    ['not a url', 'TARGUS_API_URL "not a url" is not a URL'],
    ['https://', 'TARGUS_API_URL "https://" is not a URL'],
    ['targus.example.com', 'TARGUS_API_URL "targus.example.com" has no http:// or https:// scheme'],
    [
      'https://example.com/x?y=1',
      'TARGUS_API_URL "https://example.com/x?y=1" has a ?query or #fragment',
    ],
    [
      'https://example.com/#top',
      'TARGUS_API_URL "https://example.com/#top" has a ?query or #fragment',
    ],
    [
      'https://example.com/api/',
      'TARGUS_API_URL "https://example.com/api/" ends in /api, which targus adds itself',
    ],
  ])('%j', (value, headline) => {
    expect(reason(value)).toBe(headline);
  });
});

describe('parseApiUrl suggestions and masking', () => {
  it.each([
    ['targus.example.com/', 'https://targus.example.com'],
    ['localhost:8787', 'http://localhost:8787'],
    ['127.0.0.1:8787', 'http://127.0.0.1:8787'],
    ['https://example.com/targus/api', 'https://example.com/targus'],
    ['https://example.com/?x=1', 'https://example.com'],
  ])('%s, suggesting %s', (value, suggestion) => {
    expect(failure(value)).toMatch(new RegExp(`for example ${suggestion}$`));
  });

  it.each([
    'https://ci:not-a-real-password@example.com',
    'https://not-a-real-password@example.com',
    'ci:not-a-real-password@example.com',
  ])('%s without printing the credentials', (value) => {
    const message = failure(value);

    expect(message).not.toContain('not-a-real-password');
    expect(message).toContain('***@example.com');
  });

  it('a URL with credentials because the token belongs in TARGUS_TOKEN', () => {
    expect(reason('https://ci:not-a-real-password@example.com')).toBe(
      'TARGUS_API_URL "https://***@example.com" contains a user name or password; ' +
        'the token belongs in TARGUS_TOKEN',
    );
  });
});
