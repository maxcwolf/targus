import { TargusError } from '@targus/core';
import { z } from 'zod';

/** Where the API URL came from, named in the error so the user knows what to fix. */
export type ApiUrlSource = '--api-url' | 'TARGUS_API_URL';

const exampleApiUrl = 'https://targus.example.com';

/** Any `user:password@` (or `user@`) before the host, scheme or not. */
const userinfo = /^([a-z][a-z0-9+.-]*:\/\/)?[^/@]*@/i;

/** A local Worker is served over plain http, so a scheme-less local address gets `http://`. */
const localHost = /^(localhost|127\.0\.0\.1)(:|\/|$)/;

interface Problem {
  readonly reason: string;
  /** A corrected URL to suggest when the mistake is obvious. */
  readonly suggestion?: string;
}

const notAUrl: Problem = { reason: 'is not a URL' };

/** The value as it may be printed: never with the credentials a URL might carry. */
function redact(value: string): string {
  return value.replace(userinfo, '$1***@');
}

function parseUrl(value: string): URL | null {
  return URL.canParse(value) ? new URL(value) : null;
}

/** `https://host/prefix` with every trailing slash removed: the one normal form. */
function normalise(url: URL): string {
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** The value as an http(s) URL, or what stops it being one. */
function parseHttpUrl(value: string): URL | Problem {
  if (value === '') return { reason: 'is empty' };
  if (!value.includes('://')) {
    const scheme = localHost.test(value) ? 'http' : 'https';
    const withScheme = parseUrl(`${scheme}://${value}`);
    if (withScheme === null) return notAUrl;
    return { reason: 'has no http:// or https:// scheme', suggestion: normalise(withScheme) };
  }
  const url = parseUrl(value);
  if (url === null) return notAUrl;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { reason: `uses ${url.protocol}// but only http:// and https:// are supported` };
  }
  return url;
}

/** What is wrong with an http(s) URL as the API base URL, or `null` when nothing is. */
function problemWith(url: URL): Problem | null {
  if (url.username !== '' || url.password !== '') {
    return { reason: 'contains a user name or password; the token belongs in TARGUS_TOKEN' };
  }
  if (url.search !== '' || url.hash !== '') {
    return { reason: 'has a ?query or #fragment', suggestion: normalise(url) };
  }
  const base = normalise(url);
  if (base.endsWith('/api')) {
    return { reason: 'ends in /api, which targus adds itself', suggestion: base.slice(0, -4) };
  }
  return null;
}

/** The normal form of a usable value, or what is wrong with it. */
function check(value: string): string | Problem {
  const parsed = parseHttpUrl(value);
  if (!(parsed instanceof URL)) return parsed;
  return problemWith(parsed) ?? normalise(parsed);
}

function apiUrlSchema(source: ApiUrlSource) {
  return z
    .string()
    .trim()
    .transform((value, context) => {
      const checked = check(value);
      if (typeof checked === 'string') return checked;
      const example = checked.suggestion ?? exampleApiUrl;
      context.addIssue({
        code: 'custom',
        message:
          `${source} "${redact(value)}" ${checked.reason}\n` +
          `  set --api-url or TARGUS_API_URL to the targus API's address, for example ${example}`,
      });
      return z.NEVER;
    });
}

/**
 * Validate and normalise the targus API base URL (README "Environment"). Only http and https,
 * no user name or password, no query or fragment; a path prefix (`https://host/targus`) is kept
 * for an API behind a proxy, trailing slashes are dropped, and a trailing `/api` is rejected
 * because every route already starts with it. Throws a `bad_request` TargusError naming `source`.
 */
export function parseApiUrl(value: string, source: ApiUrlSource): string {
  const result = apiUrlSchema(source).safeParse(value);
  if (result.success) return result.data;
  const message = result.error.issues.map((issue) => issue.message).join('\n');
  throw new TargusError('bad_request', message);
}
