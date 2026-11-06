import { describe, expect, it } from 'vitest';

import { signInUrl } from './auth.ts';

const returnToOf = (url: string): string | null =>
  new URLSearchParams(url.split('?')[1]).get('returnTo');

describe('signInUrl', () => {
  it('passes a same-origin path with its query and hash', () => {
    expect(returnToOf(signInUrl('/builds/b1?filter=new#top'))).toBe('/builds/b1?filter=new#top');
  });

  it.each(['https://evil.example/', '//evil.example/x', '/\\evil.example', 'builds/b1', ''])(
    'sends %j back to / instead',
    (returnTo) => {
      expect(returnToOf(signInUrl(returnTo))).toBe('/');
    },
  );
});
