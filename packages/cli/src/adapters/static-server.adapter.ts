import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

/** A built Storybook served on the loopback interface for the browser to open (ADR 0037). */
export interface StaticServer {
  /** Base URL without a trailing slash, e.g. `http://127.0.0.1:53124`. */
  readonly url: string;
  close(): Promise<void>;
}

const contentTypes: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** The file a request path names inside `root`, or `null` when it would leave `root`. */
export function filePathFor(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  } catch {
    return null;
  }
  const file = path.resolve(root, `.${decoded}`);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) return null;
  return file;
}

async function existingFile(file: string): Promise<string | null> {
  const info = await stat(file).catch(() => null);
  if (info === null) return null;
  if (info.isFile()) return file;
  if (!info.isDirectory()) return null;
  return existingFile(path.join(file, 'index.html'));
}

async function respond(root: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  const requested = filePathFor(root, req.url ?? '/');
  const file = requested === null ? null : await existingFile(requested);
  if (file === null) {
    res.writeHead(404).end();
    return;
  }
  const body = await readFile(file);
  const type = contentTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'content-length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
}

/** Serve the files under `dir` on `127.0.0.1` at a free port until `close` is called. */
export async function serveDirectory(dir: string): Promise<StaticServer> {
  const root = path.resolve(dir);
  const server = createServer((req, res) => {
    respond(root, req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
