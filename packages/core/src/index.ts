// Public surface of @targus/core. Pure domain code only: no I/O, no Node builtins, and no
// dependency other than zod, pixelmatch and pngjs (enforced by .dependency-cruiser.cjs).
// The root entry is the browser-safe surface (./browser.ts) plus the PNG image code, whose pngjs
// dependency needs Node's util, zlib and stream. Browser code imports `@targus/core/browser`
// (ADR 0025).
export * from './browser.ts';
export { diffImages, type DiffImagesOptions, type DiffImagesResult } from './images/diff-images.ts';
export { isBlankPng } from './images/is-blank.ts';
