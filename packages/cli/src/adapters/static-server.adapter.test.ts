import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { filePathFor, serveDirectory, type StaticServer } from './static-server.adapter.ts';

let root: string;
let server: StaticServer;

/** A raw request, so the path reaches the server exactly as written (fetch normalizes `..`). */
function rawStatus(rawPath: string, method = 'GET'): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(`${server.url}${rawPath}`, { method }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'targus-static-'));
  root = path.join(parent, 'storybook-static');
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), '<p>home</p>');
  await writeFile(path.join(root, 'index.json'), '{"v":5}');
  await writeFile(path.join(root, 'assets', 'Font Name.TTF'), 'font');
  await writeFile(path.join(root, 'assets', 'blob.bin'), 'bin');
  await writeFile(path.join(parent, 'secret.txt'), 'secret');
  server = await serveDirectory(root);
});

afterAll(async () => {
  await server.close();
});

describe('serveDirectory', () => {
  it('serves on the loopback interface', () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('serves files with their content type, and index.html for a directory', async () => {
    const json = await fetch(`${server.url}/index.json?v=1`);
    expect(json.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await json.text()).toBe('{"v":5}');
    const home = await fetch(`${server.url}/`);
    expect(home.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await home.text()).toBe('<p>home</p>');
    const font = await fetch(`${server.url}/assets/Font%20Name.TTF`);
    expect(font.headers.get('content-type')).toBe('font/ttf');
    const other = await fetch(`${server.url}/assets/blob.bin`);
    expect(other.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('answers HEAD without a body', async () => {
    const head = await fetch(`${server.url}/index.json`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('7');
    expect(await head.text()).toBe('');
  });

  it('answers 404 for a missing file and a directory without index.html', async () => {
    expect((await fetch(`${server.url}/missing.js`)).status).toBe(404);
    expect((await fetch(`${server.url}/assets/`)).status).toBe(404);
  });

  it('never serves a file outside the directory', async () => {
    expect(await rawStatus('/../secret.txt')).toBe(404);
    expect(await rawStatus('/%2e%2e/secret.txt')).toBe(404);
    expect(await rawStatus('/%E0%A4%A')).toBe(404);
  });

  it('refuses methods other than GET and HEAD', async () => {
    expect(await rawStatus('/index.json', 'POST')).toBe(405);
  });
});

describe('filePathFor', () => {
  it('resolves inside the root and refuses paths that leave it', () => {
    expect(filePathFor('/sb', '/a/b.js')).toBe(path.resolve('/sb/a/b.js'));
    expect(filePathFor('/sb', '/')).toBe(path.resolve('/sb'));
    expect(filePathFor('/sb', '/../sb-other/x')).toBeNull();
    expect(filePathFor('/sb', '%')).toBeNull();
  });
});
