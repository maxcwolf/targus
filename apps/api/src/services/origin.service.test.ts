import { describe, expect, it } from 'vitest';

import { createTestDeps, testConfig } from '../../test/support/in-memory.js';
import { assertSameOrigin, type RequestOrigin } from './origin.service.js';

// testConfig.publicUrl is https://targus.test.
const deps = createTestDeps();
const write = (headers: Partial<RequestOrigin>): RequestOrigin => ({
  method: 'POST',
  origin: undefined,
  secFetchSite: undefined,
  ...headers,
});

describe('assertSameOrigin', () => {
  it.each([
    ['Origin only', write({ origin: 'https://targus.test' })],
    ['Sec-Fetch-Site only', write({ secFetchSite: 'same-origin' })],
    ['both', write({ origin: 'https://targus.test', secFetchSite: 'same-origin' })],
    ['a lowercase method', write({ method: 'delete', origin: 'https://targus.test' })],
  ])('accepts a same-origin write with %s', (_, request) => {
    expect(() => {
      assertSameOrigin(deps, request);
    }).not.toThrow();
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('lets %s through from anywhere', (method) => {
    const request = { method, origin: 'https://evil.test', secFetchSite: 'cross-site' };
    expect(() => {
      assertSameOrigin(deps, request);
    }).not.toThrow();
  });

  it.each([
    ['no Origin and no Sec-Fetch-Site', write({}), 'has no Origin'],
    ['another origin', write({ origin: 'https://evil.test' }), 'Origin https://evil.test'],
    ['an opaque origin', write({ origin: 'null' }), 'Origin null'],
    ['another port', write({ origin: 'https://targus.test:8443' }), 'is not the review UI'],
    ['a sibling subdomain', write({ secFetchSite: 'same-site' }), 'Sec-Fetch-Site is same-site'],
    ['a cross-site fetch', write({ secFetchSite: 'cross-site' }), 'is cross-site'],
    ['a user navigation', write({ secFetchSite: 'none' }), 'Sec-Fetch-Site is none'],
    [
      'a same-origin Sec-Fetch-Site from another host',
      write({ origin: 'https://other.workers.dev', secFetchSite: 'same-origin' }),
      'is not the review UI',
    ],
  ])('refuses a write with %s', (_, request, message) => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(() => {
        assertSameOrigin(deps, { ...request, method });
      }).toThrow(message);
    }
    expect(() => {
      assertSameOrigin(deps, request);
    }).toThrow(expect.objectContaining({ code: 'forbidden' }));
  });

  it('compares origins, so a PUBLIC_URL with a path still matches its origin', () => {
    const withPath = { config: { ...testConfig, publicUrl: 'https://targus.test/review' } };
    expect(() => {
      assertSameOrigin(withPath, write({ origin: 'https://targus.test' }));
    }).not.toThrow();
  });
});
