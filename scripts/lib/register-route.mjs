// @ts-check
// Mounts a generated route in apps/api/src/app.ts the way the hand-written routes are mounted:
// one `import { xRoute } from './routes/x.ts';` and one `app.route('/api/x', xRoute);`.
// The edit is all or nothing; when app.ts no longer has that shape, nothing is changed and the
// generator prints the two lines instead.

export const appFile = 'apps/api/src/app.ts';

const routeImport = /^import \{ \w+ \} from '\.\/routes\/([\w-]+)\.ts';$/;
const routeMount = /^ {2}app\.route\('\/api\/[\w/-]+', \w+\);$/;

/**
 * The two lines that mount route `name`, exported as `route`.
 * @param {string} name
 * @param {string} route
 */
export function registrationLines(name, route) {
  return {
    importLine: `import { ${route} } from './routes/${name}.ts';`,
    mountLine: `  app.route('/api/${name}', ${route});`,
  };
}

/**
 * `source` (app.ts) with the route imported, among the other route imports in name order,
 * and mounted after the last `app.route(...)`; null when app.ts does not have one of each, or
 * already imports `./routes/<name>.ts`.
 * @param {string} source
 * @param {string} name
 * @param {string} route
 * @returns {string | null}
 */
export function registerRoute(source, name, route) {
  const lines = source.split('\n');
  const imports = lines.flatMap((line, index) => {
    const match = routeImport.exec(line);
    return match?.[1] === undefined ? [] : [{ index, name: match[1] }];
  });
  const lastMount = lines.findLastIndex((line) => routeMount.test(line));
  const lastImport = imports.at(-1);
  if (lastImport === undefined || lastMount === -1) return null;
  if (imports.some((existing) => existing.name === name)) return null;
  const { importLine, mountLine } = registrationLines(name, route);
  const before = imports.find((existing) => existing.name > name);
  const importAt = before === undefined ? lastImport.index + 1 : before.index;
  // Mount first: the import goes above the mount and would move it.
  lines.splice(lastMount + 1, 0, mountLine);
  lines.splice(importAt, 0, importLine);
  return lines.join('\n');
}

/**
 * `source` without the import and mount of route `name`, for cleaning up after a probe; the
 * same text when it has neither.
 * @param {string} source
 * @param {string} name
 */
export function unregisterRoute(source, name) {
  const imported = `from './routes/${name}.ts';`;
  const mounted = `app.route('/api/${name}', `;
  return source
    .split('\n')
    .filter((line) => !line.endsWith(imported) && !line.trimStart().startsWith(mounted))
    .join('\n');
}
