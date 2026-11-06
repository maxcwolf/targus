import { maxBuildsPageLimit, TargusError } from '@targus/core';

import type { BuildRecord } from './build-rows.js';

/**
 * Keyset paging of a project's builds, shared by the D1 repository and its in-memory double so
 * both page the same way. Builds are ordered by `number` descending: it is unique per project
 * (`builds_project_number_unique`, which also serves the query), so builds created in the same
 * millisecond still have a strict order and a page boundary can neither skip nor repeat one.
 * A cursor is the number of the last build of a page, encoded so clients treat it as opaque.
 */

/** Which page of a project's builds to read. */
export interface BuildPageRequest {
  readonly limit: number;
  /** A previous page's `nextCursor`; absent for the newest page. */
  readonly cursor?: string | undefined;
}

/** One page of builds, newest first, and the cursor of the next (older) page, if any. */
export interface BuildPage {
  readonly builds: BuildRecord[];
  readonly nextCursor: string | null;
}

const cursorPrefix = 'n:';
const base64Url = /^[A-Za-z0-9_-]+$/;
const cursorText = /^n:([1-9][0-9]{0,15})$/;

/** The cursor that reads the builds older than build `number`. */
export function encodeBuildCursor(number: number): string {
  return btoa(`${cursorPrefix}${String(number)}`)
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function invalidCursor(): TargusError {
  return new TargusError('bad_request', 'cursor is not one this API issued');
}

/** The build number a cursor reads below. Throws `bad_request` for anything not issued here. */
export function decodeBuildCursor(cursor: string): number {
  if (!base64Url.test(cursor)) throw invalidCursor();
  let text: string;
  try {
    text = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    throw invalidCursor();
  }
  const number = Number(cursorText.exec(text)?.[1]);
  if (!Number.isSafeInteger(number)) throw invalidCursor();
  return number;
}

/** The limit, if it is an integer 1..`maxBuildsPageLimit`; `bad_request` otherwise. */
export function checkBuildPageLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > maxBuildsPageLimit) {
    throw new TargusError(
      'bad_request',
      `limit must be an integer 1..${String(maxBuildsPageLimit)}`,
    );
  }
  return limit;
}

/**
 * The page from up to `limit + 1` builds read newest first: the extra build only says whether
 * there is a next page, so the last page has a null cursor even when it is exactly full.
 */
export function toBuildPage(newestFirst: readonly BuildRecord[], limit: number): BuildPage {
  const builds = newestFirst.slice(0, limit);
  const last = builds.at(-1);
  const more = newestFirst.length > limit && last !== undefined;
  return { builds, nextCursor: more ? encodeBuildCursor(last.number) : null };
}
