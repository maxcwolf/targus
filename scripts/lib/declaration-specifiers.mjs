// @ts-check
// Source imports name the TypeScript file (`./x.ts`, ADR 0017) and `rewriteRelativeImportExtensions`
// turns them into `./x.js` in emitted JavaScript, but tsc leaves declaration files with `./x.ts`:
// no file of that name exists in dist/, and tools that follow declarations (dependency-cruiser in
// a consumer app) fail on it. This rewrites the declaration files after `tsc -b` (ADR 0034).
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** The extension tsc gives the JavaScript emitted for each source extension. */
const emitted = /** @type {Record<string, string>} */ ({
  ts: '.js',
  tsx: '.js',
  mts: '.mjs',
  cts: '.cjs',
});

// A relative module specifier ending in a TypeScript extension, in the places a declaration file
// names a module: `from '…'`, `import '…'`, `import('…')`, `require('…')`, `declare module '…'`.
const specifierInModulePosition =
  /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bmodule\s+)(['"])(\.{1,2}\/[^'"\n]*?)((?:\.d)?\.(ts|tsx|mts|cts))\2/g;

// Any quoted relative path ending in a TypeScript extension, wherever it appears (the guard).
const anyRelativeTsSpecifier = /(['"])(\.{1,2}\/[^'"\n]*\.(?:ts|tsx|mts|cts))\1/g;

/**
 * @typedef {{ line: number, column: number, delta: number }} Shift
 *   An edit on `line` (0-based) that moved everything after `column` by `delta` characters.
 */

/**
 * Rewrite the relative TypeScript specifiers in a declaration file to the emitted `.js` names.
 * @param {string} text
 * @returns {{ text: string, shifts: Shift[] }} `shifts` lists edits that changed a line's length.
 */
export function rewriteDeclarationSpecifiers(text) {
  /** @type {Shift[]} */
  const shifts = [];
  let rewritten = '';
  let copied = 0;
  for (const match of text.matchAll(specifierInModulePosition)) {
    const [whole, keyword = '', quote = '', stem = '', extension = '', kind = ''] = match;
    const replacement = emitted[kind] ?? extension;
    const extensionEnd =
      match.index + keyword.length + quote.length + stem.length + extension.length;
    if (replacement.length !== extension.length) {
      shifts.push(position(text, extensionEnd, replacement.length - extension.length));
    }
    rewritten += `${text.slice(copied, match.index)}${keyword}${quote}${stem}${replacement}${quote}`;
    copied = match.index + whole.length;
  }
  return { text: rewritten + text.slice(copied), shifts };
}

/**
 * @param {string} text
 * @param {number} offset
 * @param {number} delta
 * @returns {Shift}
 */
function position(text, offset, delta) {
  const before = text.slice(0, offset);
  const line = before.split('\n').length - 1;
  return { line, column: offset - (before.lastIndexOf('\n') + 1), delta };
}

/**
 * Every quoted relative path ending in `.ts`, `.tsx`, `.mts` or `.cts` in `text`.
 * @param {string} text
 * @returns {string[]}
 */
export function relativeTsSpecifiers(text) {
  return [...text.matchAll(anyRelativeTsSpecifier)].map((match) => match[2] ?? '');
}

const base64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Decode the first base64 VLQ value of a source-map segment.
 * @param {string} segment
 * @returns {{ value: number, length: number }}
 */
function decodeFirstVlq(segment) {
  let result = 0;
  let shift = 0;
  let length = 0;
  for (;;) {
    const digit = base64.indexOf(segment.charAt(length));
    length += 1;
    result += (digit & 31) << shift;
    shift += 5;
    if ((digit & 32) === 0 || length >= segment.length) break;
  }
  const value = result >> 1;
  return { value: (result & 1) === 1 ? -value : value, length };
}

/**
 * @param {number} value
 * @returns {string}
 */
function encodeVlq(value) {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let encoded = '';
  do {
    let digit = rest & 31;
    rest >>>= 5;
    if (rest > 0) digit |= 32;
    encoded += base64.charAt(digit);
  } while (rest > 0);
  return encoded;
}

/**
 * Move the generated columns of one mappings line by the edits made on it. Generated columns are
 * relative to the previous segment, so each edit changes only the first segment past it.
 * @param {string} line
 * @param {Shift[]} shifts
 * @returns {string}
 */
function shiftLine(line, shifts) {
  let column = 0;
  return line
    .split(',')
    .map((segment) => {
      if (segment === '') return segment;
      const { value, length } = decodeFirstVlq(segment);
      const previous = column;
      column += value;
      const delta = shifts
        .filter((shift) => shift.column > previous && shift.column <= column)
        .reduce((sum, shift) => sum + shift.delta, 0);
      return delta === 0 ? segment : encodeVlq(value + delta) + segment.slice(length);
    })
    .join(',');
}

/**
 * Apply `shifts` to a source map's `mappings`, so it still points into the rewritten file.
 * @param {string} mappings
 * @param {Shift[]} shifts
 * @returns {string}
 */
export function shiftMappings(mappings, shifts) {
  return mappings
    .split(';')
    .map((line, index) => {
      const onLine = shifts.filter((shift) => shift.line === index);
      return onLine.length === 0 ? line : shiftLine(line, onLine);
    })
    .join(';');
}

/**
 * Declaration files under `dir`, recursively.
 * @param {string} dir
 * @returns {string[]}
 */
export function declarationFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.d\.[mc]?ts$/.test(file))
    .map((file) => path.join(dir, file));
}

/**
 * Rewrite one declaration file and, when a line changed length, its declaration map.
 * @param {string} file
 * @returns {boolean} whether the file changed
 */
function fixDeclarationFile(file) {
  const original = readFileSync(file, 'utf8');
  const { text, shifts } = rewriteDeclarationSpecifiers(original);
  if (text === original) return false;
  writeFileSync(file, text);
  const mapFile = `${file}.map`;
  if (shifts.length > 0 && existsSync(mapFile)) {
    /** @type {unknown} */
    const parsed = JSON.parse(readFileSync(mapFile, 'utf8'));
    const map = /** @type {{ mappings: string }} */ (parsed);
    map.mappings = shiftMappings(map.mappings, shifts);
    writeFileSync(mapFile, JSON.stringify(map));
  }
  return true;
}

/**
 * Rewrite every declaration file under `dir`. Idempotent: a second run changes nothing.
 * @param {string} dir
 * @returns {number} how many files changed
 */
export function fixDeclarations(dir) {
  return declarationFiles(dir).filter((file) => fixDeclarationFile(file)).length;
}

/** The packages that publish a dist/, relative to the repo root. */
export const publishedPackages = ['packages/core', 'packages/cli', 'packages/react-native'];

/**
 * Fix the declaration files in each package's dist/.
 * @param {string[]} packageDirs absolute, or relative to the current directory
 * @returns {number} how many files changed
 */
export function fixPackageDeclarations(packageDirs) {
  return packageDirs.reduce((sum, dir) => sum + fixDeclarations(path.resolve(dir, 'dist')), 0);
}
